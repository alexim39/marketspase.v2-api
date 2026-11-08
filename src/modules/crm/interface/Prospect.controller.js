import { asyncHandler } from '../../../shared/http/asyncHandler.js';
import { PartnersModel } from '../infrastructure/Prospect.models.js';
import { maskProspectContact } from '../domain/Prospect.visibility.js';

const pid = (req) => req.validated?.params?.prospectId ?? req.params.prospectId;

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

  rate: asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await uc.rate.execute({
      partnerId: me(req),
      prospectId: pid(req),
      score: body.score,
      note: body.note ?? '',
    });
    res.status(200).json({ message: 'Lead rating saved', data, success: true });
  }),

  getById: asyncHandler(async (req, res) => {
    // Read — owner, upline or admin (outsiders get 404, never confirm).
    const access = guard ? await guard.requireRead(me(req), pid(req)) : null;
    const data = await uc.getById.execute({ prospectId: pid(req) });
    const isOwner = access?.relation === 'owner';
    const isAdmin = access?.relation === 'admin';
    const owner = access?.relation === 'upline'
      ? await PartnersModel.findById(access.ownerId).select('partnerOf').lean().catch(() => null)
      : null;
    const isDirectUpline = String(owner?.partnerOf ?? '') === String(me(req) ?? '');
    const masked = maskProspectContact(data, {
      canViewContact: isOwner || isAdmin || isDirectUpline,
      bypassConsent: isOwner || isAdmin,
    });
    res.status(200).json({ message: 'Prospect retrieved successfully!', data: masked, success: true });
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
    const { items, total, stageCounts } = await uc.getByPartner.execute({
      partnerId,
      limit: q?.limit,
      skip: q?.skip,
      q: q?.q,
      stage: q?.stage,
      ids: q?.ids,
    });
    res.status(200).json({
      message: 'Prospects retrieved successfully!',
      data: items,
      success: true,
      meta: { total, limit: q?.limit ?? 50, skip: q?.skip ?? 0, stageCounts: stageCounts ?? {} },
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
      by: typeof body.by === 'string' ? body.by : undefined,
      byName: typeof body.byName === 'string' ? body.byName : undefined,
    });
    res.status(200).json({
      message: 'Prospect converted — they can now sign up through open registration.',
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

  contactListResolvePhone: asyncHandler(async (req, res) => {
    const body = req.validated?.body ?? req.body;
    const data = await uc.contactListResolvePhone.execute({
      requesterId: me(req),
      phone: body.phone,
    });
    res.status(200).json({ message: 'Contact resolved successfully', data, success: true });
  }),
  };
};
