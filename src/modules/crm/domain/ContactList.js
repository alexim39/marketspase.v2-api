/**
 * Contact-list submission rules — pure, unit-testable.
 * A new partner owes their upline a working list, not a single contact:
 * the minimum keeps the onboarding deliverable meaningful, and the batch
 * groups one submission so the upline can work it to completion.
 */

/** Minimum unsubmitted contacts before a list can go to the upline. */
export const MIN_CONTACTS = 1;

/**
 * Phone visibility for the upline workbench.
 * A prospect's phone is shared only with their direct referral upline and only
 * when the prospect agreed to be contacted. Everyone else sees the contact
 * without a phone number.
 */
export const prospectPhoneAccess = ({
  consentToContact = false,
  directUpline = false,
  hasPhone = true,
} = {}) => {
  if (!hasPhone) return { visible: false, reason: 'no-phone' };
  if (!directUpline) return { visible: false, reason: 'not-direct' };
  if (!consentToContact) return { visible: false, reason: 'no-consent' };
  return { visible: true, reason: null };
};

/** First-touch SLA: upline should attempt every submitted batch within 48h. */
export const LIST_SLA_HOURS = 48;

/** Stages that count as "worked" (anything past a fresh New row). */
export const isWorkedStage = (stage) => String(stage ?? 'New') !== 'New';

/**
 * Derived work state for one submitted batch — pure, no storage.
 * overdue = still untouched after the SLA window; hoursLeft counts down
 * to the first-touch deadline (negative when overdue).
 */
export const batchSla = ({ submittedAt, worked, now = new Date() }) => {
  const at = submittedAt ? new Date(submittedAt) : null;
  const ageMs = at && !Number.isNaN(at.getTime()) ? new Date(now).getTime() - at.getTime() : 0;
  const ageHrs = Math.max(0, Math.floor(ageMs / 3600000));
  const unworked = Math.max(0, Number(worked ?? 0) === 0 ? 1 : 0);
  const overdue = unworked === 1 && ageHrs >= LIST_SLA_HOURS;
  return {
    ageHrs,
    unworked: Number(worked ?? 0) === 0,
    overdue,
    hoursLeft: LIST_SLA_HOURS - ageHrs,
  };
};
