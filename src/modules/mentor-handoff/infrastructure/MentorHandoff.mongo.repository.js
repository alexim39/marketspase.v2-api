import { PartnersModel } from '../../identity-access/infrastructure/Auth.models.js';
import { MentorHandoffModel } from './MentorHandoff.models.js';
import { MENTOR_CONTACT_LABELS } from '../domain/MentorHandoff.domain.js';

const displayName = (partner) => (
  [partner?.name, partner?.surname].filter(Boolean).join(' ') || partner?.username || 'A new partner'
);

const contactFor = (member, preference) => {
  if (!member) return {};
  if (preference === 'email') return member.email ? { email: member.email } : {};
  if (preference === 'whatsapp' || preference === 'phone') {
    return member.phone ? { phone: member.phone } : {};
  }
  return {};
};

const shaped = (task, member) => ({
  id: String(task._id),
  partnerId: String(task.partnerId),
  mentorId: String(task.mentorId),
  source: task.source,
  status: task.status,
  preference: task.preference,
  preferenceLabel: MENTOR_CONTACT_LABELS[task.preference] ?? 'In-app chat',
  consentAt: task.consentAt ?? null,
  joinedAt: task.joinedAt,
  memberActivatedAt: task.memberActivatedAt ?? null,
  templateKey: task.templateKey ?? null,
  sentAt: task.sentAt ?? null,
  channels: task.channels ?? { chat: false, email: false, sms: false },
  firstContactAt: task.firstContactAt ?? null,
  lastContactAt: task.lastContactAt ?? null,
  reminder24At: task.reminder24At ?? null,
  reminder48At: task.reminder48At ?? null,
  day7At: task.day7At ?? null,
  escalatedAt: task.escalatedAt ?? null,
  note: task.note ?? '',
  member: member ? {
    id: String(member._id),
    name: displayName(member),
    username: member.username ?? '',
    accountState: member.accountState ?? 'member',
    activatedAt: member.activatedAt ?? null,
  } : null,
  contact: contactFor(member, task.preference),
  canContact: task.preference !== 'prefer_not_now',
});

export class MongoMentorHandoffRepository {
  async ensureTask({ partnerId, mentorId, source = 'referral', joinedAt = new Date(), preference = 'in_app', consentAt = null }) {
    const task = await MentorHandoffModel.findOneAndUpdate(
      { partnerId },
      {
        $set: { mentorId, source },
        $setOnInsert: {
          partnerId,
          joinedAt,
          preference,
          consentAt,
          status: 'pending',
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    ).lean();
    return task;
  }

  async updateFromActivation({ partnerId, preference, consentAt = null, activatedAt = null }) {
    return MentorHandoffModel.findOneAndUpdate(
      { partnerId },
      {
        $set: {
          preference,
          consentAt,
          memberActivatedAt: activatedAt,
        },
      },
      { new: true },
    ).lean();
  }

  async listForMentor(mentorId, { status = null } = {}) {
    const filter = { mentorId };
    if (status) filter.status = status;
    const tasks = await MentorHandoffModel.find(filter)
      .sort({ joinedAt: -1 })
      .limit(200)
      .lean();
    if (tasks.length === 0) return [];
    const members = await PartnersModel.find({
      _id: { $in: tasks.map((task) => task.partnerId) },
    }).select('name surname username email phone accountState activatedAt').lean();
    const byId = new Map(members.map((member) => [String(member._id), member]));
    return tasks.map((task) => shaped(task, byId.get(String(task.partnerId))));
  }

  async findForMentor(id, mentorId) {
    const task = await MentorHandoffModel.findOne({ _id: id, mentorId }).lean();
    if (!task) return null;
    const member = await PartnersModel.findById(task.partnerId)
      .select('name surname username email phone accountState activatedAt')
      .lean();
    return shaped(task, member);
  }

  async markContacted(id, mentorId, note = '') {
    const now = new Date();
    return MentorHandoffModel.findOneAndUpdate(
      { _id: id, mentorId },
      [{
        $set: {
          status: 'contacted',
          firstContactAt: { $ifNull: ['$firstContactAt', now] },
          lastContactAt: now,
          note: { $literal: String(note ?? '').trim().slice(0, 500) },
        },
      }],
      { new: true },
    ).lean();
  }

  async recordSent(id, mentorId, { templateKey, channels = {} } = {}) {
    const now = new Date();
    return MentorHandoffModel.findOneAndUpdate(
      { _id: id, mentorId },
      [{
        $set: {
          status: 'contacted',
          templateKey: { $literal: templateKey ?? null },
          sentAt: now,
          firstContactAt: { $ifNull: ['$firstContactAt', now] },
          lastContactAt: now,
          channels: {
            chat: channels.chat === true,
            email: channels.email === true,
            sms: channels.sms === true,
          },
        },
      }],
      { new: true },
    ).lean();
  }

  async updateMemberPreference(partnerId, preference, consentAt = null) {
    const now = new Date();
    await PartnersModel.updateOne(
      { _id: partnerId },
      {
        $set: {
          mentorContactPreference: preference,
          mentorContactConsentAt: consentAt,
          mentorContactPreferenceUpdatedAt: now,
        },
      },
    );
    await MentorHandoffModel.updateMany(
      { partnerId },
      { $set: { preference, consentAt } },
    );
    return { preference, consentAt };
  }

  async listReminderCandidates(now = new Date(), limit = 500) {
    return MentorHandoffModel.find({
      status: { $in: ['pending', 'contacted'] },
      preference: { $ne: 'prefer_not_now' },
      day7At: null,
      joinedAt: { $lte: new Date(now.getTime() - (24 * 60 * 60 * 1000)) },
    })
      .sort({ joinedAt: 1 })
      .limit(limit)
      .lean();
  }

  async markReminder(id, field, at = new Date()) {
    if (!['reminder24At', 'reminder48At', 'day7At', 'escalatedAt'].includes(field)) return null;
    return MentorHandoffModel.findByIdAndUpdate(
      id,
      { $set: { [field]: at } },
      { new: true },
    ).lean();
  }
}
