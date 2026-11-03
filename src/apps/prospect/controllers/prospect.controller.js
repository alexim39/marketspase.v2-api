import { ProspectModel } from "../models/prospect.model.js";
import { ProspectSurveyModel } from "../../survey/models/survey.model.js";
import { PartnersModel } from '../../partner/models/partner.model.js';
import { ClaimPoolLeadUseCase } from '../../../modules/crm/application/Prospect.claim.js';
import { buildProspectAccess, isAdminDoc } from '../../../modules/crm/application/Prospect.access.js';

// Shared paid-claim core (fee debit + atomic pool claim) — also serves v1.
const claimPoolLead = new ClaimPoolLeadUseCase({});

// Ownership guard: owner/upline/admin reads + support writes, owner/admin
// for PII, deletes and converts. Legacy routes never had auth — every
// prospect-model endpoint below is now session-checked.
const guard = buildProspectAccess({
  findProspectById: (id) => ProspectModel.findById(id).select('partnerId').lean().catch(() => null),
  findPartnerById: (id) => PartnersModel.findById(id).select('role email partnerOf').lean().catch(() => null),
});
const deny = (res, err) => res.status(err?.statusCode ?? 403).json({ message: err?.message ?? 'Forbidden', success: false });


// Prospect contact contnroller
export const CreateContactList = async (req, res) => {
  try {
    const { body } = req;

    // Session owns the prospect — a mismatched body partnerId is tampering.
    body.partnerId = req.auth?.partnerId ?? body.partnerId;

    // Check if a prospect with the same phone or email already exists
    const existingProspect = await ProspectModel.findOne({
      $or: [
        { prospectPhone: body.prospectPhone },
        { prospectEmail: body.prospectEmail }, // Adjust to your actual field name
      ],
    });

    if (existingProspect) {
      return res.status(400).json({
        message: "Prospect with this phone number or email already exist!",
        success: false
      });
    }

    // Create a new document using the data from the request body
    const newProspect = new ProspectModel(body);

    // Save the document to the database
    await newProspect.save();

    res.status(200).json({
      message: "Contact created successfully!",
      success: true
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
      success: false
    });
  }
};

// Prospect update — owner or admin only (upline coaches, never rewrites PII).
export const UpdateContactList = async (req, res) => {
  try {
    const { body } = req;
    try {
      await guard.requireOwner(req.auth?.partnerId, body.prospectId, 'edit contact details');
    } catch (err) {
      return deny(res, err);
    }
    // Explicit field map (never whole-subdoc replace); undefined keys never
    // touch the document. NOTE: legacy read `body._prospectSourceid`
    // (always undefined and wiped the field) — correct key first.
    const patch = {};
    for (const [key, value] of Object.entries({
      prospectName: body.prospectName,
      prospectSurname: body.prospectSurname,
      prospectPhone: body.prospectPhone,
      prospectEmail: body.prospectEmail,
      prospectSource: body.prospectSource ?? body._prospectSourceid,
      prospectRemark: body.prospectRemark,
    })) {
      if (value !== undefined) patch[key] = value;
    }
    const updatedProspect = await ProspectModel.findByIdAndUpdate(
      body.prospectId,
      patch,
      { new: true, runValidators: true } // new: true returns the updated document
    );

    if (!updatedProspect) {
      return res.status(404).json({ 
        message: "Prospect not found",
        success: false
      });
    }

    res.status(200).json({
      message: "Prospect has been updated successfully",
      success: true
    });

  } catch (error) {
    res.status(400).json({ 
      message: 'Error updating contact list',
      error: error.message,
      success: false
    });
  }
};

// Route handler to fetch all contacts by createdBy — owner, upline or admin.
// Optional coaching query (?page&limit&q&status&attention&channel&sort&stats):
// absent params keep the legacy full-list response byte-for-byte, so older
// callers are untouched. New callers get { data, meta: { total, page, limit,
// pages, stats? } } with server-side filter/sort/page.
export const GetContactsCreatedBy = async (req, res) => {
  try {
    const { createdBy } = req.params;

    try {
      await guard.requireListAccess(req.auth?.partnerId, createdBy);
    } catch (err) {
      return deny(res, err);
    }

    // Step 1: Find the user and get username
    const partner = await PartnersModel.findById(createdBy);
    if (!partner) {
      return res.status(404).json({ 
        message: "Partner not found",
        success: false
      });
    }

    const q = req.query ?? {};
    const hasQuery = ['page', 'limit', 'q', 'status', 'attention', 'channel', 'sort', 'stats']
      .some((k) => q[k] !== undefined && String(q[k]).trim() !== '');

    // Legacy path — no params, natural order, full array (older callers).
    if (!hasQuery) {
      const prospectObject = await ProspectModel.find({
        partnerId: partner._id,
      });

      if (!prospectObject) {
        return res.status(400).json({ 
          message: "Prospects not found",
          success: false
         });
      }

      return res.status(200).json({
        message: "Prospects retrieved successfully!",
        data: prospectObject,
        success: true
      });
    }

    const filter = buildContactListFilter(partner._id, q);
    const sort = buildContactListSort(q.sort);
    const total = await ProspectModel.countDocuments(filter).catch(() => 0);

    let docs;
    let page = 1;
    let limit = 0;
    if (q.limit !== undefined && String(q.limit).trim() !== '') {
      limit = Math.min(100, Math.max(1, parseInt(String(q.limit), 10) || 20));
      page = Math.max(1, parseInt(String(q.page), 10) || 1);
      docs = await ProspectModel.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean();
    } else {
      docs = await ProspectModel.find(filter).sort(sort).lean();
    }

    const meta = {
      total,
      page,
      limit,
      pages: limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1,
    };
    if (String(q.stats ?? '') === '1') {
      meta.stats = await contactListStats(partner._id).catch(() => null);
    }

    return res.status(200).json({
      message: "Prospects retrieved successfully!",
      data: docs,
      meta,
      success: true
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({
      message: "Error retrieving Ads",
      error: error.message,
      success: false
    });
  }
};

// --- Contact-list coaching query (mirrors the partner app's list helpers:
// status lives as `status.name` on new docs, a plain string on legacy docs). ---
const STATUS_SETS = {
  converted: ['member', 'partner'],
  archived: ['not interested', 'disqualified', 'inactive', 'archive'],
  hot: ['interested', 'closing', 'booked for session'],
};

const escapeRegExp = (s) => String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactIn = (values) => ({ $in: values.map((v) => new RegExp(`^${escapeRegExp(v)}$`, 'i')) });

/** Matches a stage name on both status shapes (subdoc `status.name`, legacy string `status`). */
const statusNameIs = (value) => {
  const pattern = new RegExp(`^${escapeRegExp(value)}$`, 'i');
  return { $or: [{ 'status.name': pattern }, { status: pattern }] };
};

const statusNameIn = (values) => {
  const pattern = exactIn(values);
  return { $or: [{ 'status.name': pattern }, { status: pattern }] };
};

const labelOf = (doc) => {
  const s = doc?.status;
  if (s && typeof s === 'object') {
    const v = s.name ?? s.stage;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  if (typeof s === 'string' && s.trim()) return s.trim();
  return 'New Prospect';
};

const daysSince = (value, now) => {
  if (!value) return 0;
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
};

const needsAttentionDoc = (doc, now) => {
  const label = labelOf(doc).toLowerCase();
  if (STATUS_SETS.converted.includes(label) || STATUS_SETS.archived.includes(label)) return false;
  if (daysSince(doc.updatedAt ?? doc.createdAt, now) >= 7) return true;
  if (label === 'new prospect' && daysSince(doc.createdAt, now) >= 2) return true;
  return false;
};

const buildContactListFilter = (partnerId, q) => {
  const filter = { partnerId };
  const text = String(q.q ?? '').trim();
  if (text) {
    const rx = new RegExp(escapeRegExp(text), 'i');
    filter.$and = (filter.$and ?? []).concat([{
      $or: [{ prospectName: rx }, { prospectSurname: rx }, { prospectPhone: rx }, { prospectEmail: rx }],
    }]);
  }
  const stage = String(q.status ?? '').trim();
  if (stage) Object.assign(filter, statusNameIs(stage));
  const channel = String(q.channel ?? '').trim().toLowerCase();
  if (channel === 'link') filter.prospectSource = /link/i;
  if (channel === 'other') filter.prospectSource = { $not: /link/i };
  const attention = String(q.attention ?? '').trim().toLowerCase();
  const now = Date.now();
  if (attention === 'converted' || attention === 'archived' || attention === 'hot' || attention === 'unworked') {
    const set = attention === 'unworked' ? ['new prospect'] : STATUS_SETS[attention];
    Object.assign(filter, statusNameIn(set));
  } else if (attention === 'attention') {
    const weekAgo = new Date(now - 7 * 86_400_000);
    const twoDaysAgo = new Date(now - 2 * 86_400_000);
    filter.$and = (filter.$and ?? []).concat([{
      $nor: [statusNameIn([...STATUS_SETS.converted, ...STATUS_SETS.archived])],
    }, {
      $or: [
        { updatedAt: { $lt: weekAgo } },
        // Pre-timestamps documents carry no updatedAt — fall back to createdAt (client parity).
        { updatedAt: { $exists: false }, createdAt: { $lt: weekAgo } },
        { $and: [statusNameIs('new prospect'), { createdAt: { $lt: twoDaysAgo } }] },
      ],
    }]);
  }
  return filter;
};

const buildContactListSort = (sort) => {
  switch (String(sort ?? '').trim().toLowerCase()) {
    case 'oldest': return { createdAt: 1 };
    case 'stuck':
    case 'attention': return { updatedAt: 1 };
    case 'name': return { prospectName: 1, prospectSurname: 1 };
    case 'newest':
    default: return { createdAt: -1 };
  }
};

/** Full-list health counts for the coaching pills (unfiltered by query). */
const contactListStats = async (partnerId) => {
  const docs = await ProspectModel.find({ partnerId })
    .select('status createdAt updatedAt')
    .lean();
  const now = Date.now();
  const stats = { total: docs.length, attention: 0, unworked: 0, hot: 0, converted: 0, archived: 0 };
  for (const d of docs) {
    const label = labelOf(d).toLowerCase();
    if (needsAttentionDoc(d, now)) stats.attention += 1;
    if (label === 'new prospect') stats.unworked += 1;
    if (STATUS_SETS.hot.includes(label)) stats.hot += 1;
    if (STATUS_SETS.converted.includes(label)) stats.converted += 1;
    if (STATUS_SETS.archived.includes(label)) stats.archived += 1;
  }
  return stats;
};

// import survey list to contacts list — owner, upline or admin of the target.
export const importSurveyToContact = async (req, res) => {
  //(surveyId) {
  try {
    const { partnerId } = req.params;

    try {
      await guard.requireListAccess(req.auth?.partnerId, partnerId);
    } catch (err) {
      return deny(res, err);
    }

    // Step 1: Find the user and get username
    const partner = await PartnersModel.findById(partnerId);
    if (!partner) {
      return res.status(400).json({ 
        message: "User not found", 
        success: false 
      });
    }

    // Step 2: user found username to get user from survey collection
    const surveys = await ProspectSurveyModel.find({
      username: partner.username,
    });

    if (surveys.length === 0) {
      return res
        .status(401)
        .json({ 
          message: "No surveys found with the matching username",
          success: false
        });
    }

    let importedCount = 0; // Counter for successful imports

    for (const survey of surveys) {
      // Check if a prospect with the same email or phone number already exists
      const existingProspect = await ProspectModel.findOne({
        $or: [
          { prospectEmail: survey.email },
          { prospectPhone: survey.phoneNumber },
        ],
      });

      if (existingProspect) {
        console.log(
          `Prospect with email ${survey.email} or phone ${survey.phoneNumber} already exists.`
        );

        // Update the prospectStatus to "Moved to Contact"
        survey.prospectStatus = "Moved to Contact";
        await survey.save();

        continue; // Skip to the next survey if a duplicate is found
      }

      // Create a new prospect using the data from the survey
      const newProspect = new ProspectModel({
        prospectName: survey.name,
        prospectSurname: survey.surname,
        prospectEmail: survey.email,
        prospectPhone: survey.phoneNumber,
        prospectSource: "Unique Link",
        partnerId: partner._id,
        surverId: survey._id,
      });

      // Save the new prospect entry to the database
      await newProspect.save();
      importedCount++; // Increment the counter
    }

    //console.log('All matching surveys successfully imported as prospects');
    res.status(200).json({
      message: `${importedCount} Prospects imported successfully!`,
      success: true
    });
  } catch (error) {
    //console.error(error.message);
    res.status(500).json({
      message: "Error importing surveys to contacts",
      error: error.message,
      success: false
    });
  }
};

// Get all survey prospect for — owner, upline or admin of that partner.
export const getSurveyProspectFor = async (req, res) => {
  try {
    const { createdBy } = req.params;

    try {
      await guard.requireListAccess(req.auth?.partnerId, createdBy);
    } catch (err) {
      return deny(res, err);
    }

    // Step 1: Find the user and get username
    const partner = await PartnersModel.findById(createdBy);
    if (!partner) {
      return res.status(404).json({ 
        message: "User not found",
        success: false
      });
    }

    /// Step 2: user found username to get user from survey collection
    const prospectObject = await ProspectSurveyModel.find({
      username: partner.username,
    });

    if (!prospectObject) {
      return res.status(400).json({ 
        message: "Prospects not found",
        success: false
      });
    }

    res.status(200).json({
      message: "Prospects retrieved successfully!",
      data: prospectObject,
      success: true
    });
  } catch (error) {
    //console.error(error.message);
    res.status(500).json({
      message: "Error retrieving Ads",
      error: error.message,
      success: false
    });
  }
};


// REMOVED: getAllSurveyProspect (unbounded unmasked pool dump, no callers)
// — admins use the paginated Admin → Lead pool desk instead.

// Get all surver prospect gotton by the system (Username !== business) —
// private page-lead inbox: the owning partner or admin only.
export const getAllMySurveyProspect = async (req, res) => {
  try {

    const { username } = req.params;

    try {
      const me = await PartnersModel.findById(req.auth?.partnerId).select('username role email').lean();
      if (!me) return deny(res, { statusCode: 401, message: 'User unauthenticated' });
      if (String(me.username) !== String(username) && !isAdminDoc(me)) {
        return res.status(404).json({
          message: "Partner prospects not found",
          success: false
        });
      }
    } catch (err) {
      return deny(res, err);
    }

    /// Step 1: user found username to get user from survey collection
    const prospectObject = await ProspectSurveyModel.find({ username: username });

    if (!prospectObject) {
      return res.status(400).json({ 
        message: "Partner prospects not found",
        success: false
      });
    }

    res.status(200).json({
      message: "Prospects retrieved successfully!",
      data: prospectObject,
      success: true
    });
  } catch (error) {
    //console.error(error.message);
    res.status(500).json({
      message: "Error retrieving Ads",
      error: error.message,
      success: false
    });
  }
};

/* Import single prospect from survey to contact */
/* export const ImportSingleProspectFromSurveyToContact = async (req, res) => {
  try {
    const { partnerId, prospectId, source } = req.params;

    // Get the user survey by prospectId
    const survey = await ProspectSurveyModel.findById(prospectId);

    if (!survey) {
      return res.status(404).json({
        message: "Survey not found.",
        success: false
      });
    }

    let prospectSource = 'Website'
    if (source === 'website') {
      prospectSource = "Website";
    } else if (source === 'link') {
      prospectSource = "Unique Link";
    }

    // Create a new prospect using the data from the survey
    const newProspect = new ProspectModel({
      prospectName: survey.name,
      prospectSurname: survey.surname,
      prospectEmail: survey.email,
      prospectPhone: survey.phoneNumber,
      prospectSource: prospectSource,
      partnerId: partnerId,
      surverId: survey._id, // Corrected typo: surverId -> surveyId
      survey: {
        ageRange: survey.ageRange,
        socialMedia: survey.socialMedia,
        employedStatus: survey.employedStatus,
        importanceOfPassiveIncome: survey.importanceOfPassiveIncome,
        onlinePurchaseSchedule: survey.onlinePurchaseSchedule,
        primaryOnlineBusinessMotivation: survey.primaryOnlineBusinessMotivation,
        comfortWithTech: survey.comfortWithTech,
        onlineBusinessTimeDedication: survey.onlineBusinessTimeDedication,
        referralCode: survey.referralCode,
        referral: survey.referral,
        country: survey.country,
        state: survey.state,
      },
    });

    // Save the new prospect entry to the database
    await newProspect.save();

    // Update the prospectStatus to "Moved to Contact"
    survey.prospectStatus = "Moved to Contact";
    await survey.save();

    // Delete the survey entry after moving to ProspectModel
    await ProspectSurveyModel.findByIdAndDelete(survey._id);

    res.status(200).json({
      message: "Prospect moved successfully to your contact list!",
      success: true
    });
  } catch (error) {
    res.status(500).json({
      message: 'Prospect not moved, something went wrong',
      error: error.message,
      success: false
    });
  }
}; */

/* Import single prospect from survey to contact — paid claim.
 * Delegates to the shared ClaimPoolLeadUseCase (fee debit, atomic claim),
 * so legacy pages and the Buy Prospect dialog run identical economics.
 * Session-owned: a mismatched param partnerId is rejected. */
export const ImportSingleProspectFromSurveyToContact = async (req, res) => {
  try {
    const { partnerId, prospectId, source } = req.params;

    // Validate required params
    if (!partnerId || !prospectId) {
      return res.status(400).json({
        message: "Missing required parameters.",
        success: false
      });
    }
    const sessionId = req.auth?.partnerId ? String(req.auth.partnerId) : null;
    if (sessionId && String(partnerId) !== sessionId) {
      return res.status(403).json({
        message: "You can only claim leads for yourself.",
        success: false
      });
    }

    const data = await claimPoolLead.execute({
      partnerId: sessionId ?? String(partnerId),
      surveyId: prospectId,
      source,
    });
    return res.status(200).json({
      message: "Prospect moved successfully to your contact list!",
      data,
      success: true
    });
  } catch (error) {
    const status = error?.statusCode ?? 500;
    return res.status(status).json({
      message: status === 500 ? 'Prospect not moved, something went wrong' : error.message,
      ...(status === 500 ? { error: error.message } : {}),
      success: false
    });
  }
};

// get single prospect by id — owner, upline or admin (outsiders get 404).
export const getProspectById = async (req, res) => {  
  try {  
      const { prospectId } = req.params;  

      try {
        await guard.requireRead(req.auth?.partnerId, prospectId);
      } catch (err) {
        return deny(res, err);
      }

      // Get the prospect based on the provided prospectId  
      const prospect = await ProspectModel.findById(prospectId);  
      
      // Check if the prospect exists  
      if (!prospect) {  
        return res.status(404).json({  
          message: 'Prospect not found', 
          success: false 
        });  
      }  

      res.status(200).json({  
          message: 'Prospect retrieved successfully!',  
          data: prospect, // Send the prepared data  
          success: true
      });  

  } catch (error) {  
    res.status(500).json({  
        message: 'Error retrieving prospect data',  
        error: error.message,  
        success: false
    });  
  }      
};  


// get status — owner, upline (support) or admin.
export const UpdateProspectStatus = async (req, res) => {
  try {
    try {
      await guard.requireSupport(req.auth?.partnerId, req.body?.prospectId);
    } catch (err) {
      return deny(res, err);
    }
    const {
      prospectId,
      status: {
        name,
        note,
        paydayDate,
        expectedDecisionDate,
        onboardingDate
      }
    } = req.body;

    // Build status update object
    const statusUpdate = {
      name,
      note,
      updatedAt: new Date()
    };

    if (paydayDate) statusUpdate.paydayDate = new Date(paydayDate);
    if (expectedDecisionDate) statusUpdate.expectedDecisionDate = new Date(expectedDecisionDate);
    if (onboardingDate) statusUpdate.onboardingDate = new Date(onboardingDate);

    // Update the prospect's status
    const prospect = await ProspectModel.findByIdAndUpdate(
      prospectId,
      { status: statusUpdate },
      { new: true, runValidators: true }
    );

    if (!prospect) {
      return res.status(404).json({
        message: "Prospect not found",
        success: false
      });
    }

    res.status(200).json({
      message: "Prospect status updated successfully!",
      success: true,
      data: prospect.status
    });
  } catch (error) {
    res.status(500).json({
      message: "Error updating prospect status",
      error: error.message,
      success: false
    });
  }
};

// Bulk stage move — owner, upline (support) or admin per prospect.
// One round trip instead of N single updates. Dotted $set (overlay merge,
// never whole-subdoc replace) so sibling status fields survive; per-id
// authz via the same support guard as the single move. Partial success is
// honest: { updated: [...], skipped: [{ prospectId, reason }] }.
export const UpdateProspectsStatusMany = async (req, res) => {
  try {
    const { prospectIds, status } = req.body ?? {};

    if (!Array.isArray(prospectIds) || prospectIds.length === 0) {
      return res.status(400).json({ message: 'prospectIds must be a non-empty array', success: false });
    }
    if (prospectIds.length > 100) {
      return res.status(400).json({ message: 'Bulk moves are capped at 100 prospects per call', success: false });
    }
    const name = typeof status === 'string' ? status.trim() : '';
    if (!name || name.length > 120) {
      return res.status(400).json({ message: 'A valid stage name is required', success: false });
    }

    const seen = new Set();
    const ids = [];
    for (const raw of prospectIds) {
      const id = String(raw ?? '').trim();
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    if (ids.length === 0) {
      return res.status(400).json({ message: 'No valid prospect ids', success: false });
    }

    // Per-prospect support check — strangers/unknown ids are skipped, never fail the batch.
    const allowed = [];
    const skipped = [];
    for (const id of ids) {
      try {
        await guard.requireSupport(req.auth?.partnerId, id);
        allowed.push(id);
      } catch (err) {
        skipped.push({ prospectId: id, reason: err?.statusCode === 404 ? 'not found' : 'no access' });
      }
    }

    let matched = 0;
    if (allowed.length > 0) {
      const now = new Date();
      const result = await ProspectModel.updateMany(
        { _id: { $in: allowed } },
        { $set: { 'status.name': name, 'status.updatedAt': now } },
        { runValidators: true },
      ).catch(() => null);
      matched = result?.modifiedCount ?? result?.matchedCount ?? 0;
    }

    // History parity with the single move: the legacy single path writes no
    // stageHistory, so bulk doesn't either — timeline semantics stay uniform.
    return res.status(200).json({
      message: allowed.length === 0
        ? 'No prospects moved — none were accessible'
        : `Moved ${matched} of ${ids.length} prospect${ids.length === 1 ? '' : 's'} to ${name}`,
      success: true,
      data: { updated: allowed, skipped },
    });
  } catch (error) {
    res.status(500).json({
      message: 'Error updating prospect statuses',
      error: error.message,
      success: false
    });
  }
};

// update coaching note — owner, upline (support) or admin. Persists to the
// canonical `notes` field (the legacy `prospectRemark` path never existed in
// the schema, so remarks posted here previously vanished).
export const UpdateProspectRemark = async (req, res) => {
  try {
    const { prospectId, remark } = req.body;
    if (!remark || !String(remark).trim()) {
      return res.status(400).json({
        message: "Remark is required",
        success: false
      });
    }
    try {
      await guard.requireSupport(req.auth?.partnerId, prospectId);
    } catch (err) {
      return deny(res, err);
    }
    const prospect = await ProspectModel.findByIdAndUpdate(
      prospectId,
      { notes: String(remark).slice(0, 2000) },
      { new: true, runValidators: true }
    );
    if (!prospect) {
      return res.status(404).json({
        message: "Prospect not found",
        success: false
      });
    }
    res.status(200).json({
      message: "Prospect note updated successfully!",
      success: true
    });
  } catch (error) {
    res.status(500).json({
      message: "Error updating prospect note",
      error: error.message,
      success: false
    });
  }
};




// delete single prospect from prospect — owner or admin only.
export const deleteSingleFromProspect = async (req, res) => {
  try {
    const { prospectId } = req.params;

    try {
      await guard.requireOwner(req.auth?.partnerId, prospectId, 'delete this prospect');
    } catch (err) {
      return deny(res, err);
    }

    // Get the prospect based on the provided prospectId
    const prospect = await ProspectModel.findById(prospectId);

    // Check if exists
    if (!prospect) {
      return res.status(404).json({
        message: "Prospect not found",
        success: false
      });
    }

    // Here we delete the survey entry
    await ProspectModel.findByIdAndDelete(prospectId);

    res.status(200).json({
      message: "Prospect deleted successfully!",
      success: true
    });
  } catch (error) {
    res.status(500).json({
      message: "Error deleting survey",
      error: error.message,
      success: false
    });
  }
};


/* Move single prospect from contact back to survey — owner or admin only. */
export const moveSingleProspectBackToSurvey = async (req, res) => {
  try {
    const { prospectId } = req.params;

    try {
      await guard.requireOwner(req.auth?.partnerId, prospectId, 'move this prospect back to survey');
    } catch (err) {
      return deny(res, err);
    }

    // Get the prospect by prospectId
    const prospect = await ProspectModel.findById(prospectId);

    if (!prospect) {
      return res.status(404).json({
        message: "Prospect not found in contacts.",
        success: false
      });
    }

    // Check if the surveyRecord exists
    if (!prospect.survey) {
      return res.status(400).json({
        message: "Prospect does not have associated survey record.",
        success: false
      });
    }

    // Create a new survey entry using the data from the prospect's surveyRecord
    const newSurvey = new ProspectSurveyModel({
      ageRange: prospect.survey.ageRange,
      socialMedia: prospect.survey.socialMedia,
      employedStatus: prospect.survey.employedStatus,
      importanceOfPassiveIncome: prospect.survey.importanceOfPassiveIncome,
      onlinePurchaseSchedule: prospect.survey.onlinePurchaseSchedule,
      primaryOnlineBusinessMotivation: prospect.survey.primaryOnlineBusinessMotivation,
      comfortWithTech: prospect.survey.comfortWithTech,
      onlineBusinessTimeDedication: prospect.survey.onlineBusinessTimeDedication,
      phoneNumber: prospect.prospectPhone, // Use prospect's phone number
      email: prospect.prospectEmail,       // Use prospect's email
      name: prospect.prospectName,         // Use prospect's name
      surname: prospect.prospectSurname,   // Use prospect's surname
      referralCode: prospect.survey.referralCode,
      referral: prospect.survey.referral,
      userDevice: prospect.userDevice,      // Assuming this was part of the original survey
      prospectStatus: 'Returned from contact List', // Reset the status
      username: prospect.username,          // Assuming this was part of the original survey
      country: prospect.survey.country || 'Nigeria', // Default if not present
      state: prospect.survey.state,
    });

    // Save the new survey entry to the database
    const savedSurvey = await newSurvey.save();

    // Optionally, update the prospect record or delete it
    // Option 1: Update prospectStatus in ProspectModel
    //prospect.prospectStatus = "Moved Back to Survey";
    //prospect.surveyId = savedSurvey._id; // Link back to the new survey
    //await prospect.save();

    // Option 2: Delete the prospect entry after moving back to SurveyModel
    await ProspectModel.findByIdAndDelete(prospectId);

    res.status(200).json({
      message: "Prospect moved back to survey list successfully!",
      //data: savedSurvey, // Send back the created survey data
      success: true
    });

  } catch (error) {
    res.status(500).json({
      message: 'Prospect not moved back to survey, something went wrong',
      error: error.message,
      success: false
    });
  }
};
