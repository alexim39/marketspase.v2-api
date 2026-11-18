import { AppError, ConflictException, ForbiddenException, NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { InMemoryOraUsageStore } from '../domain/Ora.usage.js';
import { buildSystemPrompt, greetingFor, startersForLevel } from '../domain/Ora.persona.js';
import { extractProposalBlock } from '../domain/Ora.proposals.js';
import { parsePlanDraft, planDraftFromReply } from '../domain/Ora.plans.js';
import { capabilityByKey } from '../domain/Ora.capabilities.js';
import { classifyTopic, summarizeAnalytics } from '../domain/Ora.analytics.js';

/** Recent window sent to the model — bounds tokens per call. */
export const HISTORY_WINDOW = 12;
/** Per-partner 24-hour message cap (cost control). */
export const DEFAULT_DAILY_LIMIT = 25;
export const MAX_PENDING_ACTIONS = 20;

const toHistory = (messages = []) => messages
  .filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content ?? '').trim())
  .slice(-HISTORY_WINDOW)
  .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

const titleOf = (message) => {
  const s = String(message ?? '').trim().replace(/\s+/g, ' ');
  return s.length > 60 ? `${s.slice(0, 59)}…` : (s || 'New conversation');
};

const draftFor = (proposal, opportunity, reply = '') => {
  const draft = String(proposal?.draft ?? '').trim();
  if (!draft) {
    if (opportunity.type === 'save_daily_plan') {
      const items = planDraftFromReply(reply);
      return { ...(opportunity.payload ?? {}), ...(items.length > 0 ? { items } : {}) };
    }
    if (opportunity.type === 'send_followup') {
      return {
        ...(opportunity.payload ?? {}),
        ...(proposal?.subject ? { subject: String(proposal.subject).slice(0, 120) } : {}),
      };
    }
    return opportunity.payload ?? {};
  }
  if (opportunity.type === 'save_daily_plan') {
    const parsed = parsePlanDraft(draft);
    const items = parsed.length > 0 ? parsed : planDraftFromReply(reply);
    return { ...(opportunity.payload ?? {}), ...(items.length > 0 ? { items } : {}) };
  }
  if (opportunity.type === 'send_followup') {
    return {
      ...(opportunity.payload ?? {}),
      body: draft.slice(0, 2000),
      ...(proposal?.subject ? { subject: String(proposal.subject).slice(0, 120) } : {}),
    };
  }
  return opportunity.payload ?? {};
};

/**
 * Safety net for pipeline/status questions: if the model forgot the action
 * block, still surface the best safe opportunity so the member can approve it.
 */
const fallbackProposals = (message, snapshot) => {
  const text = String(message ?? '').toLowerCase();
  const opportunities = snapshot?.opportunities ?? [];
  if (/pipeline|prospect|lead|follow.?up|\bcall\b|remind/.test(text)) {
    const message = opportunities.find((o) => o.type === 'send_followup');
    if (message) {
      return [{
        opportunityId: message.id,
        label: 'Draft follow-up',
        summary: 'Review the message before approving it',
      }];
    }
    const review = opportunities.find((o) => o.capabilityKey === 'pipeline.followups');
    if (review) return [{ capability: review.capabilityKey, label: 'Open follow-ups' }];
  }
  const humanAsk = /human|real person|speak to (someone|a person|an agent)|talk to (someone|a person|an agent)|support agent/.test(text);
  const sensitive = /payment|paid|charge|charged|deduct|refund|kyc|identity|activation|activate|withdraw|wallet|transaction/.test(text);
  const problem = /problem|issue|wrong|stuck|rejected|failed|help|not working|dispute/.test(text);
  if (humanAsk || (sensitive && problem)) {
    const useMentor = !sensitive
      && snapshot?.sponsor
      && snapshot?.mentorContactPreference !== 'prefer_not_now';
    return [{
      capability: 'support.handoff',
      target: useMentor ? 'mentor' : 'support',
      reason: String(message ?? '').trim().slice(0, 500) || 'Requested a human handoff',
      label: useMentor ? 'Ask my mentor to reach out' : 'Open a support ticket',
      summary: useMentor ? 'Your mentor will see your request' : 'Support will see the details',
    }];
  }
  if (/today|status|business|plan|next|what should i do/.test(text) && opportunities.length > 0) {
    const first = opportunities[0];
    return [first.requiresApproval
      ? { opportunityId: first.id, label: first.title, summary: first.summary || first.reason }
      : { capability: first.capabilityKey, label: first.title }];
  }
  return [];
};

/** Maps model proposals to safe, persisted approval actions. */
export const materializeProposals = async ({
  partnerId,
  conversationId,
  snapshot,
  proposals = [],
  reply = '',
  actions = null,
  maxPending = MAX_PENDING_ACTIONS,
} = {}) => {
  const opportunities = new Map((snapshot?.opportunities ?? []).map((o) => [o.id, o]));
  const materialized = [];
  let pending = 0;
  if (actions?.countProposed) pending = await actions.countProposed(partnerId).catch(() => 0);

  for (const proposal of proposals) {
    if (materialized.length >= 3) break;
    const opportunity = proposal.opportunityId ? opportunities.get(proposal.opportunityId) : null;

    if (opportunity) {
      const common = {
        partnerId,
        conversationId,
        opportunityId: opportunity.id,
        type: opportunity.type,
        capabilityKey: opportunity.capabilityKey ?? null,
        area: opportunity.area ?? '',
        title: opportunity.title ?? opportunity.id,
        label: proposal.label || opportunity.title || 'Ora action',
        summary: proposal.summary || opportunity.summary || opportunity.reason || '',
        link: opportunity.page ?? '',
      };

      if (opportunity.type === 'open_page') {
        materialized.push({
          id: null,
          ...common,
          payload: {},
          status: 'ready',
          requiresApproval: false,
          result: null,
          error: null,
        });
        continue;
      }

      if (pending >= maxPending) continue;
      const record = {
        ...common,
        payload: draftFor(proposal, opportunity, reply),
      };
      if (actions?.create) {
        try {
          const saved = await actions.create(record);
          materialized.push(saved);
        } catch {
          continue;
        }
      } else {
        materialized.push({
          id: null,
          ...record,
          status: 'proposed',
          requiresApproval: true,
          result: null,
          error: null,
        });
      }
      pending += 1;
      continue;
    }

    const capability = proposal.capability ? capabilityByKey(proposal.capability) : null;
    if (!capability) continue;
    if (capability.key === 'support.handoff') {
      if (pending >= maxPending) continue;
      const record = {
        partnerId,
        conversationId,
        opportunityId: null,
        type: 'request_handoff',
        capabilityKey: capability.key,
        area: capability.area,
        title: capability.title,
        label: proposal.label || 'Ask a human to help',
        summary: proposal.summary || capability.description,
        link: capability.page,
        payload: {
          target: proposal.target ?? 'auto',
          reason: proposal.reason || proposal.summary || '',
        },
        status: 'proposed',
        requiresApproval: true,
        result: null,
        error: null,
      };
      if (actions?.create) {
        try {
          const saved = await actions.create(record);
          materialized.push(saved);
        } catch {
          continue;
        }
      } else {
        materialized.push({ id: null, ...record });
      }
      pending += 1;
      continue;
    }
    materialized.push({
      id: null,
      partnerId,
      conversationId,
      opportunityId: null,
      type: 'open_page',
      capabilityKey: capability.key,
      area: capability.area,
      title: capability.title,
      label: proposal.label || capability.title,
      summary: proposal.summary || capability.description,
      link: capability.page,
      payload: {},
      status: 'ready',
      requiresApproval: false,
      result: null,
      error: null,
    });
  }
  return materialized;
};

/** Core chat turn: rate-limit → history → context → model → parse → persist + track. */
export class AskOraUseCase {
  /**
   * @param {{conversations, client, context, analytics?, dailyLimit?, usageStore?}} deps
   * (`usageStore` defaults to the in-memory port for tests; production passes Mongo.)
   */
  constructor({ conversations, client, context, analytics = null, actions = null, dailyLimit = DEFAULT_DAILY_LIMIT, usageStore = null }) {
    const configured = Number(dailyLimit);
    Object.assign(this, { conversations, client, context, analytics, actions });
    this.dailyLimit = Number.isFinite(configured) && configured >= 0
      ? Math.floor(configured)
      : DEFAULT_DAILY_LIMIT;
    this.usageStore = usageStore ?? new InMemoryOraUsageStore();
  }

  /** Current partner's 24-hour budget, safe to expose to the UI. */
  async usageFor(partnerId, now = new Date()) {
    const state = await this.usageStore.usage(partnerId, now);
    return this.shapeUsage(state, now);
  }

  async execute({ partnerId, message, conversationId = null, now = new Date() }) {
    const text = String(message ?? '').trim();
    if (!text || text.length > 2000) throw new ValidationException('Message must be 1–2000 characters');
    const reservation = await this.usageStore.consume(partnerId, this.dailyLimit, now);
    if (!reservation.allowed) {
      const usage = await this.usageFor(partnerId, now);
      throw new AppError(
        '24-hour Ora limit reached — please try again when your window resets',
        429,
        'ORA_RATE_LIMITED',
        { usage },
        'Your Ora window resets 24 hours after its first message.',
      );
    }
    try {
      let convo = null;
      if (conversationId) {
        convo = await this.conversations.findById(conversationId);
        if (!convo) throw new NotFoundException('Conversation not found');
        if (String(convo.partnerId) !== String(partnerId)) throw new ForbiddenException('Not your conversation');
      } else {
        convo = await this.conversations.create(partnerId, titleOf(text));
      }
      const started = Date.now();
      const history = toHistory(convo.messages ?? []);
      const snapshot = await this.context.assemble({ partnerId, now });
      let raw;
      try {
        raw = await this.client.complete({
          system: buildSystemPrompt(snapshot),
          messages: [...history, { role: 'user', content: text }],
        });
      } catch (error) {
        const lastReply = [...(convo.messages ?? [])]
          .reverse()
          .find((m) => m.role === 'assistant' && String(m.content ?? '').trim());
        if ((error?.code === 'AI_DOWN' || error?.code === 'ORA_PROVIDER_ERROR') && lastReply) {
          await this.usageStore.release(partnerId, reservation.windowStart).catch(() => null);
          return {
            conversationId: convo.id,
            reply: lastReply.content,
            actions: [],
            degraded: true,
            warning: 'AI_DOWN_USING_LAST_PICKS',
            usage: await this.usageFor(partnerId, now),
          };
        }
        throw error;
      }
      const { text: reply, proposals: parsedProposals } = extractProposalBlock(raw);
      const proposals = parsedProposals.length > 0 ? parsedProposals : fallbackProposals(text, snapshot);
      let actions = await materializeProposals({
        partnerId,
        conversationId: convo.id,
        snapshot,
        proposals,
        reply,
        actions: this.actions,
      });
      if (actions.length === 0) {
        const fallback = fallbackProposals(text, snapshot);
        if (fallback.length > 0) {
          actions = await materializeProposals({
            partnerId,
            conversationId: convo.id,
            snapshot,
            proposals: fallback,
            reply,
            actions: this.actions,
          });
        }
      }
      await this.conversations.appendMessage(convo.id, { role: 'user', content: text, at: now });
      await this.conversations.appendMessage(convo.id, { role: 'assistant', content: reply, at: new Date() });
      // Analytics never fail the turn — fire and forget.
      if (this.analytics) {
        this.analytics.recordEvent({
          partnerId, conversationId: convo.id, topic: classifyTopic(text),
          messageChars: text.length, replyChars: reply.length,
          latencyMs: Date.now() - started, at: new Date(),
        }).catch(() => null);
      }
      return { conversationId: convo.id, reply, actions, usage: await this.usageFor(partnerId, now) };
    } catch (error) {
      await this.usageStore.release(partnerId, reservation.windowStart).catch(() => null);
      throw error;
    }
  }

  shapeUsage(state, now) {
    const limit = this.dailyLimit;
    const used = Math.max(0, Number(state?.used) || 0);
    return {
      dateKey: state?.dateKey ?? now.toISOString().slice(0, 10),
      limit,
      used,
      remaining: Math.max(0, limit - used),
      resetsAt: state?.resetsAt ?? new Date(now.getTime() + 86400000).toISOString(),
      windowHours: 24,
    };
  }
}

/** Greeting + starters + ladder position for the widget's first paint. */
export class GetOraContextUseCase {
  /** @param {{context}} deps */
  constructor({ context }) {
    this.context = context;
  }

  async execute({ partnerId, now = new Date() }) {
    const snapshot = await this.context.assemble({ partnerId, now });
    return {
      displayName: snapshot.displayName,
      accountState: snapshot.accountState,
      journeyStage: snapshot.journeyStage,
      level: snapshot.level,
      levelLabel: snapshot.levelLabel,
      next: snapshot.next,
      nextLabel: snapshot.nextLabel,
      percent: snapshot.percent,
      greeting: greetingFor(snapshot),
      starters: startersForLevel(snapshot.level, { accountState: snapshot.accountState }),
    };
  }
}

export class ListOraConversationsUseCase {
  /** @param {{conversations}} deps */
  constructor({ conversations }) {
    this.conversations = conversations;
  }

  async execute({ partnerId, limit = 20, q = '' }) {
    const items = await this.conversations.listByPartner(partnerId, { limit, q });
    return {
      items: items.map((c) => ({
        id: String(c.id), title: c.title, pinned: c.pinned === true, updatedAt: c.updatedAt ?? null,
      })),
    };
  }
}

export class PinOraConversationUseCase {
  /** @param {{conversations}} deps */
  constructor({ conversations }) {
    this.conversations = conversations;
  }

  async execute({ partnerId, conversationId, pinned }) {
    const convo = await this.conversations.findById(conversationId);
    if (!convo) throw new NotFoundException('Conversation not found');
    if (String(convo.partnerId) !== String(partnerId)) throw new ForbiddenException('Not your conversation');
    const updated = await this.conversations.setPinned(partnerId, conversationId, pinned === true);
    return { id: String(updated?.id ?? conversationId), pinned: updated?.pinned === true };
  }
}

export class GetOraConversationUseCase {
  /** @param {{conversations}} deps */
  constructor({ conversations }) {
    this.conversations = conversations;
  }

  async execute({ partnerId, conversationId }) {
    const convo = await this.conversations.findById(conversationId);
    if (!convo) throw new NotFoundException('Conversation not found');
    if (String(convo.partnerId) !== String(partnerId)) throw new ForbiddenException('Not your conversation');
    return {
      id: String(convo.id),
      title: convo.title,
      messages: (convo.messages ?? []).map((m) => ({ role: m.role, content: m.content, at: m.at ?? null })),
    };
  }
}

export class DeleteOraConversationUseCase {
  /** @param {{conversations}} deps */
  constructor({ conversations }) {
    this.conversations = conversations;
  }

  async execute({ partnerId, conversationId }) {
    const convo = await this.conversations.findById(conversationId);
    if (!convo) throw new NotFoundException('Conversation not found');
    if (String(convo.partnerId) !== String(partnerId)) throw new ForbiddenException('Not your conversation');
    return this.conversations.remove(partnerId, conversationId);
  }
}

/** Personal Ora journey: questions, topics and active days over a window. */
export class GetOraAnalyticsUseCase {
  /** @param {{analytics}} deps */
  constructor({ analytics }) {
    this.analytics = analytics;
  }

  async execute({ partnerId, days = 30, now = new Date() }) {
    const windowDays = Math.min(Math.max(Number(days) || 30, 1), 90);
    const since = new Date(new Date(now).getTime() - windowDays * 86400000);
    const events = await this.analytics.eventsFor(partnerId, since);
    return summarizeAnalytics({ events, days: windowDays });
  }
}

/** Pending approvals for the Ora page and chat recovery. */
export class ListOraActionsUseCase {
  constructor({ actions }) {
    this.actions = actions;
  }

  async execute({ partnerId, status = 'proposed', limit = 20 }) {
    return this.actions.listByPartner(partnerId, { status, limit });
  }
}

/** Approve and execute one proposed action exactly once. */
export class ApproveOraActionUseCase {
  constructor({ actions, executor, audit = null }) {
    Object.assign(this, { actions, executor, audit });
  }

  async execute({ partnerId, actionId }) {
    const claimed = await this.actions.claimForExecution(partnerId, actionId);
    if (!claimed) {
      const existing = await this.actions.findById(partnerId, actionId);
      if (!existing) throw new NotFoundException('Ora action not found');
      if (existing.status === 'executed' || existing.status === 'failed' || existing.status === 'skipped') {
        return existing;
      }
      if (existing.status === 'executing') {
        throw new ConflictException('Ora is already running this action');
      }
      throw new ConflictException(`This Ora action is ${existing.status}`);
    }

    try {
      const result = await this.executor.execute({ partnerId, action: claimed });
      const updated = await this.actions.markExecuted(claimed.id, result);
      if (this.audit) {
        void this.audit({
          actorId: partnerId,
          action: 'ora.action.execute',
          targetType: 'ora-action',
          targetId: claimed.id,
          detail: {
            type: claimed.type,
            opportunityId: claimed.opportunityId,
            prospectId: claimed.payload?.prospectId ?? null,
            result,
          },
        }).catch(() => null);
      }
      return updated;
    } catch (error) {
      await this.actions.markFailed(claimed.id, error?.message ?? String(error));
      if (this.audit) {
        void this.audit({
          actorId: partnerId,
          action: 'ora.action.execute',
          targetType: 'ora-action',
          targetId: claimed.id,
          detail: {
            type: claimed.type,
            opportunityId: claimed.opportunityId,
            prospectId: claimed.payload?.prospectId ?? null,
            failed: true,
            error: String(error?.message ?? error).slice(0, 500),
          },
        }).catch(() => null);
      }
      throw new AppError(
        error?.message ?? 'Ora action failed',
        error?.statusCode ?? 500,
        error?.code ?? 'ORA_ACTION_FAILED',
        error?.details,
        error?.fix,
      );
    }
  }
}

/** Skip a proposed action; idempotent when already skipped. */
export class SkipOraActionUseCase {
  constructor({ actions, audit = null }) {
    Object.assign(this, { actions, audit });
  }

  async execute({ partnerId, actionId }) {
    const skipped = await this.actions.skip(partnerId, actionId);
    if (skipped) {
      if (this.audit) {
        void this.audit({
          actorId: partnerId,
          action: 'ora.action.skip',
          targetType: 'ora-action',
          targetId: skipped.id,
          detail: { type: skipped.type, opportunityId: skipped.opportunityId },
        }).catch(() => null);
      }
      return skipped;
    }
    const existing = await this.actions.findById(partnerId, actionId);
    if (!existing) throw new NotFoundException('Ora action not found');
    if (existing.status === 'skipped') return existing;
    throw new ConflictException(`This Ora action is ${existing.status}`);
  }
}
