import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { recordAudit } from '../../audit/index.js';

/** Admin console adapters — all routes behind requireAuth + requireRole('admin'). */
export const makeAdminController = ({ setRole, listPartners, setSuspend, platformStats, signOut, resetOnBehalf, erase, member360, reassignUpline }) => ({
  setRole: asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await setRole.execute({
      requesterId: req.auth?.partnerId,
      partnerId: params.partnerId,
      role: body.role,
    });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'role.set',
      targetType: 'partner', targetId: params.partnerId,
      detail: { to: body.role, username: data?.username ?? null },
    });
    res.status(200).json({ message: 'Role updated successfully', data, success: true });
  }),

  list: asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await listPartners.execute({
      limit: q?.limit,
      skip: q?.skip,
      q: q?.q,
      role: q?.role && q.role !== 'all' ? q.role : null,
      suspended: q?.suspended ?? 'all',
      login: q?.login ?? 'all',
    });
    res.status(200).json({ message: 'Partners retrieved successfully', data, success: true });
  }),

  suspend: asyncHandler(async (req, res) => {    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await setSuspend.execute({
      requesterId: req.auth?.partnerId,
      partnerId: params.partnerId,
      suspended: body.suspended,
      reason: body.reason ?? null,
    });
    void recordAudit({
      actorId: req.auth?.partnerId,
      action: data?.suspended ? 'account.suspend' : 'account.unsuspend',
      targetType: 'partner',
      targetId: params.partnerId,
      detail: { username: data?.username ?? null, reason: body.reason ?? null },
    });
    res.status(200).json({
      message: data?.suspended ? 'Account reactivated successfully' : 'Account suspended successfully',
      data,
      success: true,
    });
  }),

  stats: asyncHandler(async (_req, res) => {
    const data = await platformStats.execute();
    res.status(200).json({ message: 'Platform stats retrieved successfully', data, success: true });
  }),

  signOut: asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const target = await signOut({ requesterId: req.auth?.partnerId, partnerId: params.partnerId });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'account.signout',
      targetType: 'partner', targetId: params.partnerId,
    });
    res.status(200).json({ message: 'Sessions revoked — the member signs in again with their password', data: target, success: true });
  }),

  resetOnBehalf: asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    await resetOnBehalf.execute({ requesterId: req.auth?.partnerId, partnerId: params.partnerId });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'account.reset-password',
      targetType: 'partner', targetId: params.partnerId,
    });
    res.status(200).json({ message: 'If the account exists, a reset link was sent to the member email', success: true });
  }),

  erase: asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await erase.execute({ requesterId: req.auth?.partnerId, partnerId: params.partnerId });
    // Audit carries counts only — never the erased PII.
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'account.erase',
      targetType: 'partner', targetId: params.partnerId,
      detail: { removed: data?.removed ?? null },
    });
    res.status(200).json({ message: 'Account erased — profile anonymized, owned prospects/tickets/codes removed', data, success: true });
  }),

  member360: asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await member360.execute({ requesterId: req.auth?.partnerId, partnerId: params.partnerId });
    res.status(200).json({ message: 'Member profile retrieved successfully', data, success: true });
  }),

  reassignUpline: asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const body = req.validated?.body ?? req.body;
    const data = await reassignUpline.execute({
      requesterId: req.auth?.partnerId,
      partnerId: params.partnerId,
      newUplineId: body.newUplineId ?? null,
      newUplineUsername: body.newUplineUsername ?? null,
    });
    void recordAudit({
      actorId: req.auth?.partnerId, action: 'account.reassign-upline',
      targetType: 'partner', targetId: params.partnerId,
      detail: { from: data.prevUplineId, to: data.newUplineId, toUsername: data.newUplineUsername },
    });
    res.status(200).json({ message: `Upline moved to @${data.newUplineUsername ?? data.newUplineId}`, data: data.member, success: true });
  }),
});
