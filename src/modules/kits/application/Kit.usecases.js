import { NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { KIT_AREAS, createSlides } from '../domain/Kit.js';
import { KitModel } from '../infrastructure/Kit.mongo.js';
import { ProspectModel } from '../../../apps/prospect/models/prospect.model.js';

const oid = (v) => String(v);
const shaped = (t) => t ? {
  id: oid(t._id ?? t.id),
  title: t.title,
  description: t.description ?? '',
  area: t.area,
  source: t.source ?? 'manual',
  fileUrl: t.fileUrl ?? '',
  slides: (t.slides ?? []).map((s) => ({
    title: s.title,
    body: s.body,
    imageUrl: s.imageUrl ?? '',
    note: s.note ?? '',
  })),
  slideCount: (t.slides ?? []).length,
  durationMin: t.durationMin ?? 10,
  order: t.order ?? 0,
  active: t.active !== false,
  createdAt: t.createdAt ?? null,
  updatedAt: t.updatedAt ?? null,
} : null;

const cleanTitle = (title) => {
  const t = String(title ?? '').trim().slice(0, 120);
  if (t.length < 3) throw new ValidationException('Title is required');
  return t;
};

const cleanArea = (area) => {
  if (!KIT_AREAS.includes(area)) throw new ValidationException('Invalid area');
  return area;
};

/** Member list — active kits grouped by area in fixed order. */
export class ListKitsUseCase {
  /** @param {{kits}} deps */
  constructor({ kits } = {}) {
    this.kits = kits ?? KitModel;
  }

  async execute() {
    const rows = await this.kits.find({ active: true }).sort({ area: 1, order: 1, createdAt: 1 }).limit(200).lean();
    const groups = KIT_AREAS.map((area) => ({
      area,
      items: (rows ?? []).filter((r) => (r.area ?? 'Opportunity') === area).map(shaped),
    })).filter((g) => g.items.length > 0);
    return { groups, total: (rows ?? []).length };
  }
}

/** Admin list — everything with status, newest first. */
export class ListAdminKitsUseCase {
  /** @param {{kits}} deps */
  constructor({ kits } = {}) {
    this.kits = kits ?? KitModel;
  }

  async execute({ limit = 100 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const rows = await this.kits.find({}).sort({ createdAt: -1 }).limit(lim).lean();
    return { items: (rows ?? []).map(shaped), total: (rows ?? []).length };
  }
}

const cleanFileUrl = (value) => {
  const url = String(value ?? '').trim().slice(0, 1000);
  if (!/^https?:\/\//i.test(url)) throw new ValidationException('A file deck needs its uploaded PDF url');
  return url;
};

/** Admin create — manual decks carry validated slides, file decks a PDF url. */
export class CreateKitUseCase {
  /** @param {{kits}} deps */
  constructor({ kits } = {}) {
    this.kits = kits ?? KitModel;
  }

  async execute({ adminId, title, description = '', area = 'Opportunity', source = 'manual', slides, fileUrl = '', durationMin = 10, order = 0, active = true }) {
    if (source !== 'manual' && source !== 'file') throw new ValidationException('Invalid source');
    const doc = await this.kits.create({
      title: cleanTitle(title),
      description: String(description ?? '').trim().slice(0, 500),
      area: cleanArea(area),
      source,
      fileUrl: source === 'file' ? cleanFileUrl(fileUrl) : '',
      slides: source === 'file' ? [] : createSlides(slides),
      durationMin: Math.min(Math.max(Number(durationMin) || 10, 1), 120),
      order: Math.min(Math.max(Number(order) || 0, 0), 10000),
      active: active !== false,
      createdBy: adminId ?? null,
    });
    return { kit: shaped(doc.toObject?.() ?? doc) };
  }
}

/** Admin update — slides re-validated when replaced; everything else patched. */
export class UpdateKitUseCase {
  /** @param {{kits}} deps */
  constructor({ kits } = {}) {
    this.kits = kits ?? KitModel;
  }

  async execute({ kitId, patch = {} }) {
    const doc = await this.kits.findById(kitId);
    if (!doc) throw new NotFoundException('Kit not found');
    const previousFile = typeof doc.fileUrl === 'string' && doc.fileUrl ? doc.fileUrl : null;
    if (patch.title !== undefined) doc.title = cleanTitle(patch.title);
    if (patch.description !== undefined) doc.description = String(patch.description ?? '').trim().slice(0, 500);
    if (patch.area !== undefined) doc.area = cleanArea(patch.area);
    if (patch.source !== undefined) {
      if (patch.source !== 'manual' && patch.source !== 'file') throw new ValidationException('Invalid source');
      doc.source = patch.source;
      // Switching kinds resets the other side so a deck is never both.
      if (patch.source === 'file') doc.slides = [];
      else doc.fileUrl = '';
    }
    const effectiveSource = doc.source ?? 'manual';
    if (patch.fileUrl !== undefined) doc.fileUrl = String(patch.fileUrl ?? '').trim().slice(0, 1000);
    if (effectiveSource === 'file') {
      if (!/^https?:\/\//i.test(String(doc.fileUrl ?? ''))) {
        throw new ValidationException('A file deck needs its uploaded PDF url');
      }
      doc.slides = [];
    } else {
      doc.fileUrl = '';
      if (patch.slides !== undefined) doc.slides = createSlides(patch.slides);
      else if (!Array.isArray(doc.slides) || doc.slides.length === 0) {
        throw new ValidationException('A manual deck needs at least one slide');
      }
    }
    if (patch.durationMin !== undefined) {
      doc.durationMin = Math.min(Math.max(Number(patch.durationMin) || 10, 1), 120);
    }
    if (patch.order !== undefined) doc.order = Math.min(Math.max(Number(patch.order) || 0, 0), 10000);
    if (patch.active !== undefined) doc.active = patch.active !== false && patch.active !== 'false';
    await doc.save();
    const saved = shaped(doc.toObject?.() ?? doc);
    // Replaced PDFs must not linger in cloud storage — the route destroys
    // the previous asset best-effort; the row is already correct regardless.
    const currentFile = saved.fileUrl || null;
    return {
      kit: saved,
      replacedFileUrl: previousFile && previousFile !== currentFile ? previousFile : null,
    };
  }
}

/** Admin delete. */
export class DeleteKitUseCase {
  /** @param {{kits}} deps */
  constructor({ kits } = {}) {
    this.kits = kits ?? KitModel;
  }

  async execute({ kitId }) {
    const doc = await this.kits.findByIdAndDelete(kitId).lean();
    if (!doc) throw new NotFoundException('Kit not found');
    return { deleted: true, id: String(kitId), fileUrl: doc.fileUrl ?? null };
  }
}

/**
 * Presentation stats — derived from logged `presentation` touches, so the
 * numbers can only ever describe what partners actually presented.
 * Conversion = outcome `Booked session` OR prospect stage now `Converted`
 * (either signal means the deck moved the deal).
 */
const KIT_REF = /^kit:(.+)$/;

function emptyKitStats() {
  return { presented: 0, outcomes: {}, booked: 0, converted: 0 };
}

function foldPresentation(stats, prospect, comm) {
  const docs = Array.isArray(comm.documentsShared) ? comm.documentsShared : [];
  const kitIds = [...new Set(
    docs.map((d) => { const m = KIT_REF.exec(String(d ?? '')); return m ? m[1] : null; }).filter(Boolean),
  )];
  if (kitIds.length === 0) return stats;
  const stage = prospect?.status && typeof prospect.status === 'object'
    ? (prospect.status.stage ?? prospect.status.name)
    : prospect?.status;
  const converted = String(stage ?? '').toLowerCase() === 'converted';
  const booked = comm.outcome === 'Booked session';
  for (const id of kitIds) {
    const row = stats[id] ?? (stats[id] = emptyKitStats());
    row.presented += 1;
    if (comm.outcome) row.outcomes[comm.outcome] = (row.outcomes[comm.outcome] ?? 0) + 1;
    if (booked) row.booked += 1;
    if (converted) row.converted += 1;
  }
  return stats;
}

async function presentationRows(prospects, filter) {
  // Bounded scan: newest prospects first (recent presenting matters most).
  const docs = await prospects
    .find({ ...filter, 'communications.type': 'presentation' })
    .sort({ updatedAt: -1 })
    .limit(2000)
    .select('status communications')
    .lean();
  const stats = {};
  for (const p of docs ?? []) {
    for (const c of p.communications ?? []) {
      if (c?.type === 'presentation') foldPresentation(stats, p, c);
    }
  }
  return stats;
}

/** My deck stats — this partner's presentations only. */
export class KitStatsUseCase {
  /** @param {{prospects}} deps */
  constructor({ prospects } = {}) {
    this.prospects = prospects ?? ProspectModel;
  }

  async execute({ partnerId }) {
    const byKit = await presentationRows(this.prospects, { partnerId });
    const total = Object.values(byKit).reduce((n, r) => n + r.presented, 0);
    return { byKit, total };
  }
}

/** Admin deck stats — every presentation on the platform. */
export class KitAdminStatsUseCase {
  /** @param {{prospects}} deps */
  constructor({ prospects } = {}) {
    this.prospects = prospects ?? ProspectModel;
  }

  async execute() {
    const byKit = await presentationRows(this.prospects, {});
    const total = Object.values(byKit).reduce((n, r) => n + r.presented, 0);
    return { byKit, total };
  }
}
