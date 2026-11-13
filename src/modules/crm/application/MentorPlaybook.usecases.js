import { ForbiddenException, ValidationException } from '../../../shared/domain/AppError.js';
import { collectDownlineIds } from '../../network/infrastructure/Network.mongo.repository.js';
import { MentorCheckinRepository } from '../infrastructure/MentorCheckin.model.js';
import { recordAudit } from '../../audit/index.js';

const KINDS = ['welcome', 'day3', 'day7', 'ad_hoc'];

/**
 * Records a mentor check-in against a downline member. The mentor must
 * actually own the member in the single-upline tree.
 */
export class RecordMentorCheckinUseCase {
  constructor({ network, checkins = new MentorCheckinRepository(), audit = recordAudit } = {}) {
    Object.assign(this, { network, checkins, audit });
  }

  async execute({ mentorId, memberId, kind = 'ad_hoc', note = '' }) {
    const cleanKind = KINDS.includes(kind) ? kind : 'ad_hoc';
    if (!/^[a-fA-F0-9]{24}$/.test(String(memberId ?? ''))) throw new ValidationException('Invalid member');
    const { ids } = await collectDownlineIds(this.network, mentorId);
    if (!ids.map(String).includes(String(memberId))) {
      throw new ForbiddenException('This member is not in your downline');
    }
    const checkin = await this.checkins.create({
      mentorId,
      memberId,
      kind: cleanKind,
      note: String(note ?? '').trim().slice(0, 500),
    });
    void this.audit({
      actorId: mentorId,
      action: 'mentor.checkin.record',
      targetType: 'partner',
      targetId: String(memberId),
      detail: { kind: cleanKind },
    });
    return checkin;
  }
}
