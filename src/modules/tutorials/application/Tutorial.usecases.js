import { NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { TUTORIAL_AREAS, extractYouTubeId } from '../domain/Tutorial.youtube.js';
import { TutorialModel } from '../infrastructure/Tutorial.mongo.js';

const oid = (v) => String(v);
const shaped = (t) => t ? {
  id: oid(t._id ?? t.id),
  title: t.title,
  description: t.description ?? '',
  youtubeId: t.youtubeId,
  area: t.area,
  order: t.order ?? 0,
  active: t.active !== false,
  createdAt: t.createdAt ?? null,
  updatedAt: t.updatedAt ?? null,
} : null;

/** Member list — active tutorials grouped by area in fixed order. */
export class ListTutorialsUseCase {
  /** @param {{tutorials}} deps */
  constructor({ tutorials } = {}) {
    this.tutorials = tutorials ?? TutorialModel;
  }

  async execute() {
    const rows = await this.tutorials.find({ active: true }).sort({ area: 1, order: 1, createdAt: 1 }).limit(200).lean();
    const groups = TUTORIAL_AREAS.map((area) => ({
      area,
      items: (rows ?? []).filter((r) => (r.area ?? 'Start') === area).map(shaped),
    })).filter((g) => g.items.length > 0);
    return { groups, total: (rows ?? []).length };
  }
}

/** Admin list — everything with status, newest first. */
export class ListAdminTutorialsUseCase {
  /** @param {{tutorials}} deps */
  constructor({ tutorials } = {}) {
    this.tutorials = tutorials ?? TutorialModel;
  }

  async execute({ limit = 100 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const rows = await this.tutorials.find({}).sort({ createdAt: -1 }).limit(lim).lean();
    return { items: (rows ?? []).map(shaped), total: (rows ?? []).length };
  }
}

/** Admin create — paste any YouTube URL, we store the verified id. */
export class CreateTutorialUseCase {
  /** @param {{tutorials}} deps */
  constructor({ tutorials } = {}) {
    this.tutorials = tutorials ?? TutorialModel;
  }

  async execute({ adminId, url, title, description = '', area = 'Start', order = 0, active = true }) {
    const id = extractYouTubeId(url);
    if (!id) throw new ValidationException('Paste a valid YouTube link (watch, youtu.be, shorts or embed)');
    const cleanTitle = String(title ?? '').trim().slice(0, 120);
    if (cleanTitle.length < 3) throw new ValidationException('Title is required');
    if (!TUTORIAL_AREAS.includes(area)) throw new ValidationException('Invalid area');
    const doc = await this.tutorials.create({
      title: cleanTitle,
      description: String(description ?? '').trim().slice(0, 500),
      youtubeId: id,
      url: String(url ?? '').trim().slice(0, 300),
      area,
      order: Math.min(Math.max(Number(order) || 0, 0), 10000),
      active: active !== false,
      createdBy: adminId ?? null,
    });
    return { tutorial: shaped(doc.toObject?.() ?? doc) };
  }
}

/** Admin update — URL re-verified when changed; everything else patched. */
export class UpdateTutorialUseCase {
  /** @param {{tutorials}} deps */
  constructor({ tutorials } = {}) {
    this.tutorials = tutorials ?? TutorialModel;
  }

  async execute({ tutorialId, patch = {} }) {
    const doc = await this.tutorials.findById(tutorialId);
    if (!doc) throw new NotFoundException('Tutorial not found');
    if (patch.url !== undefined) {
      const id = extractYouTubeId(patch.url);
      if (!id) throw new ValidationException('Paste a valid YouTube link (watch, youtu.be, shorts or embed)');
      doc.youtubeId = id;
      doc.url = String(patch.url).trim().slice(0, 300);
    }
    if (patch.title !== undefined) {
      const t = String(patch.title ?? '').trim().slice(0, 120);
      if (t.length < 3) throw new ValidationException('Title is required');
      doc.title = t;
    }
    if (patch.description !== undefined) doc.description = String(patch.description ?? '').trim().slice(0, 500);
    if (patch.area !== undefined) {
      if (!TUTORIAL_AREAS.includes(patch.area)) throw new ValidationException('Invalid area');
      doc.area = patch.area;
    }
    if (patch.order !== undefined) doc.order = Math.min(Math.max(Number(patch.order) || 0, 0), 10000);
    if (patch.active !== undefined) doc.active = patch.active !== false && patch.active !== 'false';
    await doc.save();
    return { tutorial: shaped(doc.toObject?.() ?? doc) };
  }
}

/** Admin delete. */
export class DeleteTutorialUseCase {
  /** @param {{tutorials}} deps */
  constructor({ tutorials } = {}) {
    this.tutorials = tutorials ?? TutorialModel;
  }

  async execute({ tutorialId }) {
    const doc = await this.tutorials.findByIdAndDelete(tutorialId).lean();
    if (!doc) throw new NotFoundException('Tutorial not found');
    return { deleted: true, id: String(tutorialId) };
  }
}
