/**
 * Domain service ported 1:1 from `src/apps/utils/generateNotifications.js`
 * (logic identical), except it operates on plain domain objects instead of
 * Mongoose docs — pure, deterministic, unit-testable with fixtures.
 */

const capitalizeFirstLetter = (s) => {
  const v = String(s ?? '');
  return v.charAt(0).toUpperCase() + v.slice(1);
};

export function buildProspectNotifications(prospects, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const notifications = [];

  for (const prospect of prospects ?? []) {
    const fullName = `${capitalizeFirstLetter(prospect.prospectName)} ${capitalizeFirstLetter(prospect.prospectSurname) || ''}`.trim();
    const status = prospect.status ?? {};
    if (status?.status === 'Closed') continue;

    const daysBetween = (date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    };

    if (status?.expectedDecisionDate) {
      const days = daysBetween(status.expectedDecisionDate);
      if (days === 0) {
        notifications.push({ title: `URGENT: Call ${fullName}`, description: 'Expected decision is today', icon: 'priority_high', tag: 'Decision checkpoint', urgency: true, status, prospectId: prospect.id ?? prospect._id });
      } else if (days < 0) {
        notifications.push({ title: `OVERDUE: Follow up with ${fullName}`, description: `Expected decision was ${Math.abs(days)} day(s) ago`, icon: 'report', tag: 'Missed decision', urgency: true, status, prospectId: prospect.id ?? prospect._id });
      } else {
        notifications.push({ title: `Reminder: ${fullName}'s decision in ${days} day(s)`, description: 'Expected decision is upcoming', icon: 'event_note', tag: 'Upcoming decision', status, prospectId: prospect.id ?? prospect._id });
      }
    }

    if (status?.paydayDate) {
      const days = daysBetween(status.paydayDate);
      if (days === 0) {
        notifications.push({ title: `Follow up: ${fullName}'s Pay Day is today`, description: 'Follow up now to close', icon: 'attach_money', tag: 'Payday today', urgency: true, status, prospectId: prospect.id ?? prospect._id });
      } else if (days < 0) {
        notifications.push({ title: `${fullName}'s Pay Day was ${Math.abs(days)} day(s) ago`, description: 'Time to check in again', icon: 'money_off', tag: 'Payday passed', urgency: true, status, prospectId: prospect.id ?? prospect._id });
      } else {
        notifications.push({ title: `${fullName}'s Pay Day in ${days} day(s)`, description: 'Prepare to follow up', icon: 'attach_money', tag: 'Upcoming payday', status, prospectId: prospect.id ?? prospect._id });
      }
    }

    if (status?.onboardingDate) {
      const days = daysBetween(status.onboardingDate);
      if (days === 0) {
        notifications.push({ title: `Onboard ${fullName} today`, description: 'Scheduled onboarding is today', icon: 'event', tag: 'Action required', status, prospectId: prospect.id ?? prospect._id });
      } else if (days < 0) {
        notifications.push({ title: `${fullName}'s onboarding was ${Math.abs(days)} day(s) ago`, description: 'Confirm if completed', icon: 'history', tag: 'Onboarding missed', status, prospectId: prospect.id ?? prospect._id });
      } else {
        notifications.push({ title: `Upcoming onboarding for ${fullName}`, description: `Scheduled in ${days} day(s)`, icon: 'event_upcoming', tag: 'Upcoming onboarding', status, prospectId: prospect.id ?? prospect._id });
      }
    }

    const openCommunications = (prospect.communications ?? []).filter((c) => c.status !== 'Closed');
    const lastComm = openCommunications[openCommunications.length - 1];
    // Committed callback dates — the follow-up promise itself. Skips
    // Closed-lost outcomes; a fresh touch without a date clears it.
    if (lastComm?.followUpDate && lastComm?.outcome !== 'Closed-lost') {
      const days = daysBetween(lastComm.followUpDate);
      if (Number.isFinite(days) && days <= 7) {
        if (days < 0) {
          notifications.push({ title: `OVERDUE: Call back ${fullName}`, description: `Promised follow-up was ${Math.abs(days)} day(s) ago`, icon: 'report', tag: 'Follow-up overdue', urgency: true, status, prospectId: prospect.id ?? prospect._id });
        } else if (days === 0) {
          notifications.push({ title: `Call back ${fullName} today`, description: 'You promised a follow-up for today', icon: 'priority_high', tag: 'Follow-up due', urgency: true, status, prospectId: prospect.id ?? prospect._id });
        } else {
          notifications.push({ title: `Follow up with ${fullName} in ${days} day(s)`, description: 'Callback coming up', icon: 'event_note', tag: 'Follow-up upcoming', status, prospectId: prospect.id ?? prospect._id });
        }
      }
    }
    if (lastComm?.date) {
      const commDate = new Date(lastComm.date);
      const daysSince = Math.floor((today.getTime() - commDate.getTime()) / (1000 * 60 * 60 * 24));
      const typeIcons = { call: 'call', text: 'sms', email: 'mail', zoom: 'smart_display', whatsapp: 'chat' };
      const base = { communication: { ...lastComm }, prospectId: prospect.id ?? prospect._id };
      if (lastComm.interestLevel === 'hot' && daysSince <= 2) {
        notifications.push({ title: `Call ${fullName}`, description: `Expressed strong interest ${daysSince} day(s) ago`, icon: typeIcons[lastComm.type] || 'notifications', tag: 'Hot Lead', ...base });
        continue;
      }
      if (lastComm.followUpAction && lastComm.followUpAction !== 'To be determined') {
        notifications.push({ title: `${capitalizeFirstLetter(lastComm.type)} ${fullName}`, description: `${lastComm.followUpAction}`, icon: typeIcons[lastComm.type] || 'notifications', tag: 'Follow-up needed', ...base });
        continue;
      }
      if (daysSince === 1 && String(lastComm.description ?? '').toLowerCase().includes('delivered')) {
        notifications.push({ title: `Text ${fullName}`, description: 'Product samples delivered yesterday', icon: 'sms', tag: 'Confirmation needed', ...base });
        continue;
      }
    }
  }

  return notifications;
}
