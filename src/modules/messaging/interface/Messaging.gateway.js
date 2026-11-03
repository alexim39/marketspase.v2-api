import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { isSessionRevoked } from '../../identity-access/infrastructure/SessionRevocation.js';
import { SendDirectUseCase, MarkReadUseCase } from '../application/Messaging.usecases.js';
import { MongoMessageStore } from '../infrastructure/Messaging.mongo.repository.js';
import { MongoNetworkRepository } from '../../network/infrastructure/Network.mongo.repository.js';
import { PartnersModel } from '../../identity-access/infrastructure/Auth.models.js';
import { createAttachmentEntities } from '../../community/domain/Post.entity.js';
import { buildPushSender } from '../../notifications/infrastructure/PushSender.js';
import { MongoStoredNotificationStore } from '../../notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { env } from '../../../shared/config/env.js';

/**
 * Real-time messaging gateway (socket.io).
 *
 * Transport only — every state change runs through the same use cases as
 * the REST routes, so validation, relationship guards and limits are
 * single-sourced. REST stays fully functional as fallback; if a proxy
 * blocks WebSocket upgrades the client transparently uses polling/REST.
 *
 * Events (client -> server):
 *   message:send { to, body, clientId? } -> ack { ok, message?, error? }
 *   message:read { messageId }          -> ack { ok, error? }
 *   typing:start|typing:stop { to }     -> no ack (ephemeral)
 * Events (server -> client rooms `user:<id>`):
 *   message:new { message } | message:read { messageId, readerId }
 *   typing { from, typing } | presence { userId, online }
 */

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;
const BODY_MAX = 2000;
const SEND_LIMIT = 30;
const TYPING_LIMIT = 60;
const WINDOW_MS = 60000;

export const roomFor = (partnerId) => `user:${String(partnerId)}`;
export const groupRoom = (groupId) => `group:${String(groupId)}`;

/** Extract the session cookie the REST layer sets (cross-origin safe fallback). */
export function cookieToken(cookieHeader) {
  const m = /(?:^|;\s*)jwt=([^;]+)/.exec(String(cookieHeader ?? ''));
  return m ? decodeURIComponent(m[1].trim()) : null;
}

/** Token check mirrors requireAuth (JWT + revocation kill-switch). */
export async function verifySocketToken(token) {
  const raw = String(token ?? '').trim();
  if (!raw) throw new Error('No token provided');
  let claims;
  try {
    claims = jwt.verify(raw, process.env.JWTTOKENSECRET);
  } catch {
    throw new Error('Invalid or expired token');
  }
  const id = String(claims?.id ?? '');
  if (!id) throw new Error('Unauthenticated');
  if (await isSessionRevoked(id).catch(() => false)) throw new Error('Session revoked');
  return id;
}

/** Sliding-window per-key limiter (pure — unit tested). */
export function takeToken(bucket, now, limit, windowMs = WINDOW_MS) {
  const cutoff = now - windowMs;
  while (bucket.length > 0 && bucket[0] <= cutoff) bucket.shift();
  if (bucket.length >= limit) return false;
  bucket.push(now);
  return true;
}

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error) => ({ ok: false, error: error?.message ?? String(error) });

export function buildMessagingGateway(deps = {}) {
  const messages = deps.messages ?? new MongoMessageStore();
  const network = deps.network ?? new MongoNetworkRepository();
  const partners = deps.partners ?? PartnersModel;
  const direct = deps.direct ?? new SendDirectUseCase({ messages, network });
  const read = deps.read ?? new MarkReadUseCase({ messages });
  const findMessage = deps.findMessage ?? ((id) => messages.findById(id));
  const rooms = deps.rooms ?? null; // test double: { to(id): { emit(ev, payload) } }
  const groups = deps.groups ?? null; // GroupStore: set by the host app; null = DMs only
  const push = deps.push ?? {
    sender: buildPushSender(env.push, env.appBaseUrl),
    subscriptions: new MongoStoredNotificationStore(),
  };
  // Overridable liveness check (tests); default inspects the live adapter.
  const hasLiveSockets = deps.hasLiveSockets ?? ((io, partnerId) => {
    try {
      return (io.sockets.adapter.rooms.get(roomFor(partnerId))?.size ?? 0) > 0;
    } catch {
      return true; // unknown — don't push blindly
    }
  });

  const emitTo = (io, partnerId, event, payload) => {
    if (rooms) {
      rooms.to(String(partnerId))?.emit(event, payload);
      return;
    }
    io.to(roomFor(partnerId)).emit(event, payload);
  };

  const touchPresence = async (partnerId) => {
    try {
      await partners.updateOne(
        { _id: partnerId, $or: [{ lastSeenAt: null }, { lastSeenAt: { $lt: new Date(Date.now() - 120000) } }] },
        { $set: { lastSeenAt: new Date() } },
      );
    } catch { /* presence is best-effort */ }
  };

  const contactIds = async (partnerId) => {
    try {
      const ids = new Set();
      let current = String(partnerId);
      for (let d = 0; d < 10 && current; d++) {
        const node = await network.findNode(current).catch(() => null);
        const parent = node?.parentId ? String(node.parentId) : null;
        if (!parent || parent === String(partnerId)) break;
        ids.add(parent);
        current = parent;
      }
      const children = await network.findChildren([String(partnerId)], 500).catch(() => []);
      for (const c of children ?? []) ids.add(String(c.id));
      ids.delete(String(partnerId));
      return [...ids];
    } catch {
      return [];
    }
  };

  const onConnection = (io) => async (socket) => {
    const me = String(socket.data.partnerId);
    const buckets = { send: [], typing: [] };
    socket.join(roomFor(me));
    await touchPresence(me);
    for (const id of await contactIds(me)) emitTo(io, id, 'presence', { userId: me, online: true });
    // Member groups join their rooms so group traffic arrives live.
    if (groups?.memberGroups) {
      try {
        for (const gid of await groups.memberGroups(me)) socket.join(groupRoom(gid));
      } catch { /* groups are additive — never break connect */ }
    }

    /** Web-push nudge when the recipient has no live socket — best-effort. */
  const notifyOffline = async (to, message) => {
    try {
      if (hasLiveSockets(io, to)) return;
      const subs = await push.subscriptions.listSubscriptions(to).catch(() => []);
      if (!subs || subs.length === 0) return;
      const sender = await partners.findById(String(message.senderId)).select('name surname').lean().catch(() => null);
      const senderName = sender
        ? [sender.name, sender.surname].filter(Boolean).join(' ') || 'Teammate'
        : 'Teammate';
      const text = String(message.body ?? '');
      const body = text.length > 140 ? `${text.slice(0, 139)}…` : text;
      await Promise.all((subs ?? []).map(async (sub) => {
        try {
          const res = await push.sender.send({
            subscription: sub,
            title: `New message from ${senderName}`,
            body,
            link: '/dashboard/messages',
          });
          if (res?.gone) await push.subscriptions.pruneSubscription(to, sub.endpoint).catch(() => null);
        } catch { /* one bad endpoint never fails the batch */ }
      }));
    } catch { /* push is best-effort — the in-app message already landed */ }
  };

  /** Offline push for group members (unmuted, no live socket). Best-effort. */
  const notifyGroupOffline = async (gid, senderId, message, groupName) => {
    try {
      if (!groups?.notifyTargets) return;
      const targets = await groups.notifyTargets(gid, senderId).catch(() => []);
      if (!targets || targets.length === 0) return;
      const sender = await partners.findById(String(senderId)).select('name surname').lean().catch(() => null);
      const senderName = sender
        ? [sender.name, sender.surname].filter(Boolean).join(' ') || 'Teammate'
        : 'Teammate';
      const text = String(message.body ?? '');
      const body = text.length > 140 ? `${text.slice(0, 139)}…` : text;
      await Promise.all((targets ?? []).map(async (to) => {
        try {
          if (hasLiveSockets(io, to)) return;
          const subs = await push.subscriptions.listSubscriptions(to).catch(() => []);
          await Promise.all((subs ?? []).map(async (sub) => {
            try {
              const res = await push.sender.send({
                subscription: sub,
                title: `${senderName} in ${groupName ?? 'a group chat'}`,
                body,
                link: '/dashboard/messages',
              });
              if (res?.gone) await push.subscriptions.pruneSubscription(to, sub.endpoint).catch(() => null);
            } catch { /* one bad endpoint never fails the batch */ }
          }));
        } catch { /* per-recipient failures stay local */ }
      }));
    } catch { /* push is best-effort */ }
  };

  const emitToGroup = (io, gid, event, payload) => {
    if (rooms) {
      rooms.to(groupRoom(gid))?.emit(event, payload);
      return;
    }
    io.to(groupRoom(gid)).emit(event, payload);
  };

    socket.on('message:send', async (payload, ack) => {
      const reply = (v) => { try { typeof ack === 'function' && ack(v); } catch { /* ignore */ } };
      try {
        // Validate shape first so malformed payloads never burn rate budget.
        const gid = payload?.groupId ? String(payload.groupId) : '';
        const body = String(payload?.body ?? '').trim();
        const rawAttachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
        let attachments = [];
        if (rawAttachments.length > 0) {
          try {
            attachments = createAttachmentEntities(rawAttachments);
          } catch (error) {
            throw new Error(error?.message ?? 'Invalid attachments');
          }
        }
        if (body.length > BODY_MAX) throw new Error('Message must be 1–2000 characters');
        if (!body && attachments.length === 0) {
          // DMs keep the legacy wording (pinned by tests); groups name the real rule.
          throw new Error(gid ? 'Message must have text or an attachment' : 'Message must be 1–2000 characters');
        }
        let to = '';
        if (gid) {
          if (!OBJECT_ID_RE.test(gid)) throw new Error('Invalid group');
        } else {
          to = String(payload?.to ?? '');
          if (!OBJECT_ID_RE.test(to)) throw new Error('Invalid recipient');
        }
        if (!takeToken(buckets.send, Date.now(), SEND_LIMIT)) {
          throw new Error('Slow down — too many messages');
        }
        // Group branch: membership-checked, fanned out to the group room.
        if (gid) {
          if (!groups) throw new Error('Groups unavailable — refresh and retry');
          const membership = await groups.isMember(gid, me).catch(() => false);
          if (!membership) throw new Error('You are not in this group');
          const message = await groups.createGroupMessage({ groupId: gid, senderId: me, body, attachments });
          const shaped = { ...message, id: String(message?.id ?? message?._id ?? '') };
          emitToGroup(io, gid, 'message:new', { message: shaped, groupId: gid });
          reply(ok({ message: shaped, clientId: payload?.clientId ?? null }));
          void (async () => {
            try {
              const g = await groups.getGroup(gid).catch(() => null);
              await notifyGroupOffline(gid, me, shaped, g?.name ?? null);
            } catch { /* best-effort */ }
          })();
          return;
        }
        const message = await direct.execute({ senderId: me, to, body });
        const shaped = { ...message, id: String(message?.id ?? message?._id ?? '') };
        emitTo(io, to, 'message:new', { message: shaped });
        emitTo(io, me, 'message:new', { message: shaped });
        reply(ok({ message: shaped, clientId: payload?.clientId ?? null }));
        void notifyOffline(to, shaped);
      } catch (error) {
        reply(fail(error));
      }
    });

    socket.on('message:read', async (payload, ack) => {
      const reply = (v) => { try { typeof ack === 'function' && ack(v); } catch { /* ignore */ } };
      try {
        const messageId = String(payload?.messageId ?? '');
        if (!OBJECT_ID_RE.test(messageId)) throw new Error('Invalid message');
        await read.execute({ partnerId: me, messageId });
        const msg = await findMessage(messageId).catch(() => null);
        const senderId = msg?.senderId ? String(msg.senderId) : null;
        if (senderId && senderId !== me) {
          emitTo(io, senderId, 'message:read', { messageId, readerId: me });
        }
        reply(ok({ messageId }));
      } catch (error) {
        reply(fail(error));
      }
    });

    const typing = (on) => async (payload) => {
      try {
        if (!takeToken(buckets.typing, Date.now(), TYPING_LIMIT)) return;
        const gid = payload?.groupId ? String(payload.groupId) : '';
        if (gid) {
          if (!OBJECT_ID_RE.test(gid)) return;
          if (await groups?.isMember(gid, me).catch(() => false)) {
            emitToGroup(io, gid, 'typing', { from: me, groupId: gid, typing: on });
          }
          return;
        }
        const to = String(payload?.to ?? '');
        if (!OBJECT_ID_RE.test(to)) return;
        emitTo(io, to, 'typing', { from: me, typing: on });
      } catch { /* ephemeral — never fail */ }
    };
    socket.on('typing:start', typing(true));
    socket.on('typing:stop', typing(false));

    // Explicit join/leave so a socket only ever hears rooms it belongs in.
    // Membership is re-checked server-side; the client cannot force entry.
    socket.on('group:join', async (payload, ack) => {
      const reply = (v) => { try { typeof ack === 'function' && ack(v); } catch { /* ignore */ } };
      try {
        const gid = String(payload?.groupId ?? '');
        if (!OBJECT_ID_RE.test(gid)) throw new Error('Invalid group');
        if (!groups) throw new Error('Groups unavailable');
        if (!(await groups.isMember(gid, me).catch(() => false))) {
          throw new Error('Join from the group page first');
        }
        if (typeof socket.join === 'function') socket.join(groupRoom(gid));
        reply(ok({ groupId: gid }));
      } catch (error) {
        reply(fail(error));
      }
    });

    socket.on('group:leave', async (payload, ack) => {
      const reply = (v) => { try { typeof ack === 'function' && ack(v); } catch { /* ignore */ } };
      try {
        const gid = String(payload?.groupId ?? '');
        if (!OBJECT_ID_RE.test(gid)) throw new Error('Invalid group');
        if (typeof socket.leave === 'function') socket.leave(groupRoom(gid));
        reply(ok({ groupId: gid }));
      } catch (error) {
        reply(fail(error));
      }
    });

    socket.on('disconnect', async () => {
      // Transient offline signal for live viewers; the DB timestamp
      // stays untouched (it records last real activity, not socket state).
      for (const id of await contactIds(me)) emitTo(io, id, 'presence', { userId: me, online: false });
      if (groups?.memberGroups) {
        for (const gid of await groups.memberGroups(me).catch(() => [])) {
          emitToGroup(io, gid, 'presence', { userId: me, online: false });
        }
      }
    });
  };

  return { emitTo, touchPresence, onConnection };
}

export function attachMessagingGateway(httpServer, deps = {}) {
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    transports: ['polling', 'websocket'],
  });
  const gateway = buildMessagingGateway(deps);
  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.auth?.token ?? cookieToken(socket.handshake.headers?.cookie);
      socket.data.partnerId = await verifySocketToken(raw);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  io.on('connection', gateway.onConnection(io));
  return io;
}
