import { NotFoundException } from '../../../shared/domain/AppError.js';
import { createCommunicationEntity } from '../domain/Prospect.entity.js';
import { PROSPECT_WORKED_EVENTS, prospectWorkedPayload } from '../domain/ProspectWorkedEvents.js';

/** POST /v1/prospects/:id/communications — $push a validated entry. */
export class LogCommunicationUseCase {
  /** @param {{prospects, events?}} deps */
  constructor({ prospects, events = null }) { Object.assign(this, { prospects, events }); }
  async execute({ prospectId, ...communication }) {
    const entry = createCommunicationEntity(communication);
    const updated = await this.prospects.pushCommunication(prospectId, entry);
    if (!updated) throw new NotFoundException('Prospect not found');
    // Reverse fan-out: tell the owner when someone else worked their prospect.
    // Best-effort — a notify failure never fails the log.
    if (this.events) {
      try {
        const comms = updated.communications ?? [];
        const saved = comms[comms.length - 1] ?? {};
        const ownerId = updated.partnerId ? String(updated.partnerId) : null;
        const actorId = entry.createdBy ? String(entry.createdBy) : null;
        if (ownerId && actorId && ownerId !== actorId) {
          const name = `${updated.prospectName ?? ''} ${updated.prospectSurname ?? ''}`.trim() || 'A prospect';
          await this.events.emit(
            PROSPECT_WORKED_EVENTS.TOUCHED,
            prospectWorkedPayload({
              prospectId,
              ownerId,
              actorId,
              actorName: entry.createdByName ?? null,
              kind: 'touch',
              label: name,
              touchId: String(saved._id ?? saved.id ?? Date.now()),
            }),
          ).catch(() => null);
        }
      } catch { /* notify never fails the log */ }
    }
    return updated;
  }
}

/**
 * DELETE /v1/prospects/:id/communications/:communicationId.
 * Legacy re-fetched the doc (2 round-trips); new checks the returned
 * document in memory — one write, zero extra reads.
 */
export class RemoveCommunicationUseCase {
  /** @param {{prospects}} deps */
  constructor({ prospects }) { this.prospects = prospects; }
  async execute({ prospectId, communicationId }) {
    const { prospect, removed } = await this.prospects.pullCommunication(prospectId, communicationId);
    if (!prospect) throw new NotFoundException('Prospect not found');
    if (!removed) throw new NotFoundException('Communication not found within the prospect');
    return { removed: true };
  }
}
