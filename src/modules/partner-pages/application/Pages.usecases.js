import { NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { PartnersModel } from '../../../apps/partner/models/partner.model.js';
import { StoreModel } from '../../stores/infrastructure/Store.models.js';
import { CreateProspectUseCase } from '../../crm/application/Prospect.commands.js';
import { MongoProspectRepository } from '../../crm/infrastructure/Prospect.mongo.repository.js';

const LANDING_FIELDS = [
  'headline', 'subHeadline', 'heroBadge', 'businessTagline',
  'aboutStory', 'achievements', 'inviteNote', 'opportunityPoints',
  'videoTestimonialUrl', 'displayPhone', 'displayEmail',
  'locationDisplay', 'whatsappCtaText', 'testimonial',
  'jobTitle', 'bio',
  'whatsappGroupLink', 'whatsappChatLink',
  'facebookPage', 'linkedinPage', 'youtubePage',
  'instagramPage', 'tiktokPage', 'twitterPage',
];

const SECTION_MAP = {
  hero: ['headline', 'subHeadline', 'heroBadge', 'businessTagline', 'jobTitle'],
  story: ['bio', 'aboutStory', 'achievements', 'locationDisplay'],
  opportunity: ['opportunityPoints', 'inviteNote'],
  proof: ['testimonial', 'videoTestimonialUrl'],
  contact: [
    'whatsappGroupLink', 'whatsappChatLink', 'whatsappCtaText',
    'displayPhone', 'displayEmail',
    'facebookPage', 'linkedinPage', 'youtubePage',
    'instagramPage', 'tiktokPage', 'twitterPage',
  ],
};

const filled = (v) => {
  if (Array.isArray(v)) return v.filter((s) => String(s ?? '').trim()).length > 0;
  return String(v ?? '').trim().length > 0;
};

const completeness = (d) => {
  const checks = [
    filled(d.headline), filled(d.subHeadline),
    filled(d.aboutStory ?? d.bio),
    filled(d.testimonial),
    (Array.isArray(d.opportunityPoints) ? d.opportunityPoints.filter((s) => String(s).trim()).length : 0) > 0,
    filled(d.whatsappGroupLink ?? d.whatsappChatLink),
  ];
  const done = checks.filter(Boolean).length;
  return { done, total: checks.length, pct: Math.round((done / checks.length) * 100) };
};

/**
 * GET /v1/admin/pages — public-page moderation desk.
 * Lists partners with landing completeness + public path.
 */
export class ListPublicPagesUseCase {
  constructor({ partners } = {}) {
    this.partners = partners ?? PartnersModel;
  }

  async execute({ q = null, status = null, limit = 25, skip = 0 } = {}) {
    const lim = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const sk = Math.max(Number(skip) || 0, 0);
    const needle = String(q ?? '').trim().slice(0, 80);
    const filter = {};
    if (needle) {
      const rx = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ username: rx }, { name: rx }, { surname: rx }, { email: rx }];
    }
    const [rows, total] = await Promise.all([
      this.partners.find(filter).sort({ updatedAt: -1 }).skip(sk).limit(lim)
        .select(['username', 'name', 'surname', 'email', 'jobTitle', ...LANDING_FIELDS, 'updatedAt'].join(' '))
        .lean().catch(() => []),
      this.partners.countDocuments(filter).catch(() => 0),
    ]);
    let items = (rows ?? []).map((d) => {
      const c = completeness(d);
      const socials = ['facebookPage', 'linkedinPage', 'youtubePage', 'instagramPage', 'tiktokPage', 'twitterPage']
        .filter((k) => filled(d[k])).length;
      return {
        id: String(d._id),
        username: d.username ?? '',
        name: `${d.name ?? ''} ${d.surname ?? ''}`.trim(),
        email: d.email ?? '',
        headline: d.headline ?? '',
        completeness: c.pct,
        hasStory: filled(d.aboutStory ?? d.bio),
        hasTestimonial: filled(d.testimonial),
        opportunityCount: Array.isArray(d.opportunityPoints) ? d.opportunityPoints.filter((s) => String(s).trim()).length : 0,
        socials,
        publicPath: d.username ? `/${d.username}` : '',
        updatedAt: d.updatedAt ?? null,
      };
    });
    if (status === 'complete') items = items.filter((r) => r.completeness >= 80);
    else if (status === 'partial') items = items.filter((r) => r.completeness > 0 && r.completeness < 80);
    else if (status === 'empty') items = items.filter((r) => r.completeness === 0);
    return { items, total };
  }
}

/**
 * GET /v1/admin/pages/:id — full landing payload for inspection.
 */
export class GetPublicPageUseCase {
  constructor({ partners } = {}) {
    this.partners = partners ?? PartnersModel;
  }

  async execute({ id }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(id ?? ''))) throw new ValidationException('Invalid id');
    const doc = await this.partners.findById(id)
      .select(['username', 'name', 'surname', ...LANDING_FIELDS].join(' '))
      .lean().catch(() => null);
    if (!doc) throw new NotFoundException('Partner not found');
    return { id: String(doc._id), username: doc.username, name: `${doc.name ?? ''} ${doc.surname ?? ''}`.trim(), landing: Object.fromEntries(LANDING_FIELDS.map((k) => [k, doc[k] ?? (k === 'opportunityPoints' ? [] : '')])) };
  }
}

/**
 * PATCH /v1/admin/pages/:id/reset — clear one section (or all).
 * Moderation-safe: empties content, never deletes the account.
 * Sections: hero | story | opportunity | proof | contact | all.
 */
export class ResetPublicPageUseCase {
  constructor({ partners } = {}) {
    this.partners = partners ?? PartnersModel;
  }

  async execute({ id, section = 'all' }) {
    if (!/^[a-fA-F0-9]{24}$/.test(String(id ?? ''))) throw new ValidationException('Invalid id');
    const keys = section === 'all' ? LANDING_FIELDS : SECTION_MAP[section];
    if (!keys) throw new ValidationException('Invalid section (hero|story|opportunity|proof|contact|all)');
    const unset = Object.fromEntries(keys.map((k) => [k, k === 'opportunityPoints' ? [] : '']));
    const doc = await this.partners.findByIdAndUpdate(id, { $set: unset }, { new: true })
      .select('username').lean().catch(() => null);
    if (!doc) throw new NotFoundException('Partner not found');
    return { id: String(id), section, cleared: keys.length };
  }
}

/**
 * Public personal lead page — safe partner landing content plus the store
 * link. No email, phone or private account fields are exposed.
 */
export class GetPublicLandingUseCase {
  constructor({ partners, stores } = {}) {
    this.partners = partners ?? PartnersModel;
    this.stores = stores ?? StoreModel;
  }

  async execute({ username }) {
    const handle = String(username ?? '').trim();
    if (!/^[A-Za-z0-9._-]{2,80}$/.test(handle)) throw new ValidationException('Invalid page');
    const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const doc = await this.partners.findOne({
      username: new RegExp(`^${escaped}$`, 'i'),
      accountState: { $in: [null, 'member', 'partner'] },
    }).select([
      'username', 'name', 'surname', 'profileImage',
      ...LANDING_FIELDS,
    ].join(' ')).lean();
    if (!doc) throw new NotFoundException('Page not found');

    const store = await this.stores.findOne({
      partnerId: doc._id,
      status: 'published',
    }).select('slug name tagline logo').lean().catch(() => null);

    return {
      username: doc.username,
      name: [doc.name, doc.surname].filter(Boolean).join(' ') || doc.username,
      profileImage: doc.profileImage ?? '',
      landing: Object.fromEntries(LANDING_FIELDS.map((key) => [
        key,
        key === 'opportunityPoints'
          ? (Array.isArray(doc[key]) ? doc[key].filter((v) => String(v ?? '').trim()).slice(0, 8) : [])
          : (doc[key] ?? ''),
      ])),
      store: store
        ? { slug: store.slug, name: store.name || doc.username, tagline: store.tagline ?? '', logo: store.logo ?? '' }
        : null,
    };
  }
}

/**
 * POST a lead from the public personal page. This is an opt-in submission,
 * so it creates a normal pipeline prospect with consentToContact=true.
 */
export class SubmitPublicLeadUseCase {
  constructor({ partners, prospects } = {}) {
    this.partners = partners ?? PartnersModel;
    this.create = new CreateProspectUseCase({
      prospects: prospects ?? new MongoProspectRepository(),
    });
  }

  async execute({ username, lead = {} }) {
    const handle = String(username ?? '').trim();
    if (!/^[A-Za-z0-9._-]{2,80}$/.test(handle)) throw new ValidationException('Invalid page');
    const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const partner = await this.partners.findOne({
      username: new RegExp(`^${escaped}$`, 'i'),
      accountState: { $in: [null, 'member', 'partner'] },
    }).select('_id username').lean();
    if (!partner) throw new NotFoundException('Page not found');

    return this.create.execute({
      partnerId: String(partner._id),
      prospectName: lead.name,
      prospectSurname: lead.surname ?? '',
      prospectPhone: lead.phone,
      prospectEmail: lead.email ?? '',
      prospectSource: 'Personal Page',
      consentToContact: true,
      notes: lead.message ?? '',
      relationship: 'Referral',
    });
  }
}
