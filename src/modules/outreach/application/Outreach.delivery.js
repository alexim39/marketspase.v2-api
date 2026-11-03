import { NotFoundException, ValidationException } from '../../../shared/domain/AppError.js';
import { ParterSMSModel } from '../../../apps/sms/models/sms.model.js';

/**
 * Provider delivery reports land here (BulkSMSNigeria-style callbacks
 * POST `{customer_reference, status, ...}`). Reference shape
 * `<transactionId>:<index>` (stamped per recipient at send time) maps a
 * report back to its sms record; unknown references are ignored, never
 * errors. Guarded by an optional shared secret — when SMS_CALLBACK_TOKEN
 * is unset the route still accepts (documented, dev-friendly).
 */
export class SmsDeliveryCallbackUseCase {
  /** @param {{records, callbackToken?}} deps */
  constructor({ records, callbackToken = '' } = {}) {
    Object.assign(this, {
      records: records ?? ParterSMSModel,
      callbackToken,
    });
  }

  async execute({ token, reference, status, raw = {} }) {
    if (this.callbackToken && token !== this.callbackToken) {
      throw new ValidationException('Invalid callback token');
    }
    const ref = String(reference ?? raw.customer_reference ?? raw.reference ?? raw.ref ?? '').trim();
    const txId = ref.split(':')[0];
    if (!/^[a-fA-F0-9]{24}$/.test(txId)) return { matched: false };
    const state = normalizeStatus(status ?? raw.status ?? raw.delivery_status ?? raw.state ?? raw.event);
    if (!state) return { matched: false };
    const updated = await this.records.findOneAndUpdate(
      { transactionId: txId },
      { $set: { [`delivery.${ref}`]: state } },
      { new: false },
    ).lean();
    return { matched: updated !== null, reference: ref, status: state };
  }
}

const DELIVERED_RE = /^(delivered|dlr|success|sent|accepted)$/i;
const FAILED_RE = /^(failed|failure|rejected|undelivered|expired|error)$/i;
const PENDING_RE = /^(pending|queued|submitted|buffered|sent_to_gateway)$/i;

const normalizeStatus = (value) => {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (DELIVERED_RE.test(s)) return 'delivered';
  if (FAILED_RE.test(s)) return 'failed';
  if (PENDING_RE.test(s)) return 'pending';
  return `info:${s.slice(0, 40)}`;
};
