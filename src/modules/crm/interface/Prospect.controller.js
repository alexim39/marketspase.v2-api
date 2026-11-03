import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { PartnersModel } from '../infrastructure/Prospect.models.js';
import { adminBootstrapEmails, lenientRole } from '../../identity-access/domain/PartnerRole.js';

const pid = (req) => req.validated?.params?.prospectId ?? req.params.prospectId;

/** Admin check mirroring requireRole (pool reads stay open to members). */
const isAdminRequest = async (req) => {
  try {
    const doc = await PartnersModel.findById(req.auth?.partnerId).select('role email').lean();
    if (!doc) return false;
    if (lenientRole(doc.role) === 'admin') return true;
    return adminBootstrapEmails().includes(String(doc.email ?? '').toLowerCase());
  } catch {
    return false;
  }
};

/** Interface: HTTP adapters preserving legacy envelopes (+ additive `data`/`meta`). */
export const makeProspectController = (uc, opts = {}) => {
  // Ownership guard (owner/upline/admin). Null-safe so unit tests that build
  // the controller without a guard keep working — prod wiring always passes
  // one (see Prospect.routes.js).
  const guard = opts.guard ?? null;
  const me = (req) => (req.auth?.partnerId ? String(req.auth.partnerId) : null);
  return {
  create: asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    // Session owns the prospect: a mismatched body partnerId is tampering, not input.
    const sessionId = req.auth?.partnerId ? String(req.auth.partnerId) : null;
    if (body.partnerId && sessionId && String(body.partnerId) !== sessionId) {
      return res.status(403).json({ message: 'You can only create prospects for yourself', success: false });
    }
    const data = await uc.create.execute({ ...body, partnerId: sessionId ?? body.partnerId });
    res.status(200).json({ message: 'Contact created successfully!', success: true, data });
  }),

  importContacts: asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    // Session owns the import: partnerId always comes from auth.
    const data = await uc.importContacts.execute({ partnerId: me(req), rows: body.rows });
    res.status(200).json({
      message: `Imported ${data.inserted} of ${data.total} contacts${data.skipped.length > 0 ? ` (${data.skipped.length} skipped)` : ''}`,
      data, success: true,
    });
  }),

  update: asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const prospectId = req.validated?.params?.prospectId ?? req.params.prospectId ?? body.prospectId;
    // PII edit — owner or admin only (upline coaches, never rewrites).
    if (guard) await guard.requireOwner(me(req), prospectId, 'edit contact details');
    await uc.update.execute({ prospectId, ...body });
    res.status(200).json({ message: 'Prospect has been updated successfully', success: true });
  }),

  updateStatus: asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    // Legacy shape nests fields under `status:{...}`; canonical path takes them flat.
    const prospectId = pid(req) ?? body.prospectId;
    // Stage move / note — owner, upline (support, attributed) or admin.
    if (guard) await guard.requireSupport(me(req), prospectId);
    const status = body.status && typeof body.status === 'object' ? body.status : body;
    const data = await uc.updateStatus.execute({ prospectId, status });
    res.status(200).json({ message: 'Prospect status updated successfully!', success: true, data: data.status });
  }),

  remove: asyncHandler(async (req, res) => {
    // Destructive — owner or admin only.
    if (guard) await guard.requireOwner(me(req), pid(req), 'delete this prospect');
    await uc.remove.execute({ prospectId: pid(req) });
    res.status(200).json({ message: 'Prospect deleted successfully!', success: true });
  }),

  release: asyncHandler(async (req, res) => {
    const data = await uc.release.execute({ partnerId: req.auth?.partnerId, prospectId: pid(req) });
    res.status(200).json({
      message: data.refunded > 0
        ? `Lead returned to Buy Prospect — ₦${Number(data.refunded).toLocaleString()} refunded to your wallet.`
        : 'Lead returned to Buy Prospect — others can claim it now.',
      data,
      success: true,
    });
  }),

  claim: asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await uc.claim.execute({
      partnerId: req.auth?.partnerId,
      surveyId: body.surveyId,
      source: body.source ?? 'website',
    });
    res.status(200).json({ message: `Lead claimed — ₦${Number(data.fee).toLocaleString()} from your wallet.`, data, success: true });
  }),

  pool: asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await uc.pool.execute({
      partnerId: req.auth?.partnerId,
      isAdmin: await isAdminRequest(req),
      state: q.state,
      limit: q.limit,
      skip: q.skip,
      q: q.q,
    });
    res.status(200).json({ message: 'Lead pool retrieved successfully', data, success: true });
  }),

  rate: asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await uc.rate.execute({
      partnerId: req.auth?.partnerId,
      prospectId: pid(req),
      score: body.score,
      note: body.note ?? '',
    });
    res.status(200).json({ message: 'Thanks — your rating sharpens future leads.', data, success: true });
  }),

  importLeads: asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await uc.importLeads.execute({ rows: body.rows });
    res.status(200).json({ message: `Imported ${data.inserted} of ${data.total} leads`, data, success: true });
  }),

  adminLeads: asyncHandler(async (req, res) => {
    const q = req.validated?.query ?? req.query;
    const data = await uc.adminLeads.execute({
      q: q.q, state: q.state,
      status: q.status && q.status !== 'all' ? q.status : null,
      limit: q.limit, skip: q.skip,
    });
    res.status(200).json({ message: 'Pool leads retrieved successfully', data, success: true });
  }),

  adminLeadDelete: asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await uc.adminLeadDelete.execute({ id: params.leadId });
    res.status(200).json({ message: `Pool lead deleted${data.name ? ` (${data.name})` : ''}`, data, success: true });
  }),

  adminLeadReset: asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    const data = await uc.adminLeadReset.execute({ id: params.leadId });
    res.status(200).json({ message: 'Pool lead reopened — it is claimable again', data, success: true });
  }),
  getById: asyncHandler(async (req, res) => {
    // Read — owner, upline or admin (outsiders get 404, never confirm).
    if (guard) await guard.requireRead(me(req), pid(req));
    const data = await uc.getById.execute({ prospectId: pid(req) });
    res.status(200).json({ message: 'Prospect retrieved successfully!', data, success: true });
  }),

  remindersMine: asyncHandler(async (req, res) => {
    // Session-owned: the id comes from auth, never params — nothing to guard.
    const data = await uc.reminders.execute({ partnerId: me(req) });
    res.status(200).json({ message: 'Follow-up reminders retrieved successfully', data, success: true });
  }),

  getByPartner: asyncHandler(async (req, res) => {
    const partnerId = req.validated?.params?.partnerId ?? req.params.partnerId ?? req.params.createdBy;
    // List read — owner, upline or admin.
    if (guard) await guard.requireListAccess(me(req), partnerId);
    const q = req.validated?.query ?? req.query;
    const { items, total } = await uc.getByPartner.execute({ partnerId, limit: q?.limit, skip: q?.skip, q: q?.q, stage: q?.stage });
    res.status(200).json({
      message: 'Prospects retrieved successfully!',
      data: items,
      success: true,
      meta: { total, limit: q?.limit ?? 50, skip: q?.skip ?? 0 },
    });
  }),

  logCommunication: asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const prospectId = pid(req) ?? body.prospectId;
    // Touch — owner, upline (support, attributed) or admin.
    if (guard) await guard.requireSupport(me(req), prospectId);
    await uc.logCommunication.execute({ prospectId, ...body });
    res.status(200).json({ message: 'Prospect communication updated successfully!', success: true });
  }),

  removeCommunication: asyncHandler(async (req, res) => {
    const params = req.validated?.params ?? req.params;
    // History delete — owner or admin only.
    if (guard) await guard.requireOwner(me(req), params.prospectId, 'delete communication history');
    await uc.removeCommunication.execute(params);
    res.status(200).json({ message: 'Communication deleted successfully!', success: true });
  }),

  notifications: asyncHandler(async (req, res) => {
    const partnerId = req.validated?.params?.partnerId ?? req.params.partnerId;
    if (guard) await guard.requireListAccess(me(req), partnerId);
    const data = await uc.notifications.execute({ partnerId });
    res.status(200).json({ message: 'Notifications built successfully!', data, success: true });
  }),

  stuck: asyncHandler(async (req, res) => {
    const partnerId = req.validated?.params?.partnerId ?? req.params.partnerId;
    if (guard) await guard.requireListAccess(me(req), partnerId);
    const q = req.validated?.query ?? req.query;
    const data = await uc.stuck.execute({ partnerId, days: q?.days });
    res.status(200).json({ message: 'Stuck prospects retrieved successfully!', data, success: true });
  }),

  convert: asyncHandler(async (req, res) => {    const body = req.validated?.body ?? req.body ?? {};
    // Enrollment credit stays with the owner — owner or admin only.
    if (guard) await guard.requireOwner(me(req), pid(req), 'convert this prospect');
    const data = await uc.convert.execute({
      prospectId: pid(req),
      code: typeof body.code === 'string' ? body.code : undefined,
      by: typeof body.by === 'string' ? body.by : undefined,
      byName: typeof body.byName === 'string' ? body.byName : undefined,
    });
    res.status(200).json({
      message: 'Reservation code recorded. Share it with the prospect to complete signup.',
      data,
      success: true,
    });
  }),

  contactListMine: asyncHandler(async (req, res) => {
    const data = await uc.contactListMine.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Contact list retrieved successfully', data, success: true });
  }),

  contactListSubmit: asyncHandler(async (req, res) => {
    const data = await uc.contactListSubmit.execute({ partnerId: req.auth?.partnerId });
    res.status(200).json({ message: 'Contact list submitted to your upline', data, success: true });
  }),

  contactListDownline: asyncHandler(async (req, res) => {
    const data = await uc.contactListDownline.execute({ requesterId: req.auth?.partnerId });
    res.status(200).json({ message: 'Downline contact lists retrieved successfully', data, success: true });
  }),

  contactListActivation: asyncHandler(async (req, res) => {
    const data = await uc.contactListActivation.execute({ requesterId: req.auth?.partnerId });
    res.status(200).json({ message: 'Activation board retrieved successfully', data, success: true });
  }),
  };
};
