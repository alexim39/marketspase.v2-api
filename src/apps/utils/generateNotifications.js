import { ProspectModel } from './../prospect/models/prospect.model.js';

export async function GeneratePartnerNotifications(partnerId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const notifications = [];
  const prospects = await ProspectModel.find({ partnerId });

  for (const prospect of prospects) {
    const fullName = `${capitalizeFirstLetter(prospect.prospectName)} ${capitalizeFirstLetter(prospect.prospectSurname) || ''}`.trim();
    const status = prospect.status?.toObject?.() || prospect.status;

    // ❌ Skip if status is closed
    if (status?.status === 'Closed') continue;

    // Utility function to compare days difference
    const daysBetween = (date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return Math.floor((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    };

    // 1. Decision Date Notification
    if (status?.expectedDecisionDate) {
      const days = daysBetween(status.expectedDecisionDate);
      if (days === 0) {
        notifications.push({
          title: `URGENT: Call ${fullName}`,
          description: `Expected decision is today`,
          icon: 'priority_high',
          tag: 'Decision checkpoint',
          urgency: true,
          status,
          prospectId: prospect._id,
        });
      } else if (days < 0) {
        notifications.push({
          title: `OVERDUE: Follow up with ${fullName}`,
          description: `Expected decision was ${Math.abs(days)} day(s) ago`,
          icon: 'report',
          tag: 'Missed decision',
          urgency: true,
          status,
          prospectId: prospect._id,
        });
      } else {
        notifications.push({
          title: `Reminder: ${fullName}'s decision in ${days} day(s)`,
          description: `Expected decision is upcoming`,
          icon: 'event_note',
          tag: 'Upcoming decision',
          status,
          prospectId: prospect._id,
        });
      }
    }

    // 2. Pay Day Notification
    if (status?.paydayDate) {
      const days = daysBetween(status.paydayDate);
      if (days === 0) {
        notifications.push({
          title: `Follow up: ${fullName}'s Pay Day is today`,
          description: `Follow up now to close`,
          icon: 'attach_money',
          tag: 'Payday today',
          urgency: true,
          status,
          prospectId: prospect._id,
        });
      } else if (days < 0) {
        notifications.push({
          title: `${fullName}'s Pay Day was ${Math.abs(days)} day(s) ago`,
          description: `Time to check in again`,
          icon: 'money_off',
          tag: 'Payday passed',
          status,
          prospectId: prospect._id,
        });
      } else {
        notifications.push({
          title: `${fullName}'s Pay Day in ${days} day(s)`,
          description: `Prepare to follow up`,
          icon: 'attach_money',
          tag: 'Upcoming payday',
          status,
          prospectId: prospect._id,
        });
      }
    }

    // 3. Onboarding Reminder
    if (status?.onboardingDate) {
      const days = daysBetween(status.onboardingDate);
      if (days === 0) {
        notifications.push({
          title: `Onboard ${fullName} today`,
          description: `Scheduled onboarding is today`,
          icon: 'event',
          tag: 'Action required',
          status,
          prospectId: prospect._id,
        });
      } else if (days < 0) {
        notifications.push({
          title: `${fullName}'s onboarding was ${Math.abs(days)} day(s) ago`,
          description: `Confirm if completed`,
          icon: 'history',
          tag: 'Onboarding missed',
          status,
          prospectId: prospect._id,
        });
      } else {
        notifications.push({
          title: `Upcoming onboarding for ${fullName}`,
          description: `Scheduled in ${days} day(s)`,
          icon: 'event_upcoming',
          tag: 'Upcoming onboarding',
          status,
          prospectId: prospect._id,
        });
      }
    }

    // ✅ Only use non-closed communications
    const openCommunications = prospect.communications?.filter(comm => comm.status !== 'Closed');
    const lastComm = openCommunications?.[openCommunications.length - 1];
    if (lastComm && lastComm.date) {
      const commDate = new Date(lastComm.date);
      const daysSince = Math.floor((today.getTime() - commDate.getTime()) / (1000 * 60 * 60 * 24));

      const typeIcons = {
        call: 'call',
        text: 'sms',
        email: 'mail',
        zoom: 'smart_display',
        whatsapp: 'chat',
      };

      const baseCommNotification = {
        communication: lastComm.toObject?.() || lastComm,
        prospectId: prospect._id,
      };

      // a. Hot Lead
      if (lastComm.interestLevel === 'hot' && daysSince <= 2) {
        notifications.push({
          title: `Call ${fullName}`,
          description: `Expressed strong interest ${daysSince} day(s) ago`,
          icon: typeIcons[lastComm.type] || 'notifications',
          tag: 'Hot Lead',
          ...baseCommNotification,
        });
        continue;
      }

      // b. Follow-up Action
      if (lastComm.followUpAction && lastComm.followUpAction !== 'To be determined') {
        notifications.push({
          title: `${capitalizeFirstLetter(lastComm.type)} ${fullName}`,
          description: `${lastComm.followUpAction}`,
          icon: typeIcons[lastComm.type] || 'notifications',
          tag: 'Follow-up needed',
          ...baseCommNotification,
        });
        continue;
      }

      // c. Confirmation Needed
      if (daysSince === 1 && lastComm.description?.toLowerCase().includes('delivered')) {
        notifications.push({
          title: `Text ${fullName}`,
          description: `Product samples delivered yesterday`,
          icon: 'sms',
          tag: 'Confirmation needed',
          ...baseCommNotification,
        });
        continue;
      }
    }
  }

  return notifications;
}

function capitalizeFirstLetter(string) {
  return string.charAt(0).toUpperCase() + string.slice(1);
}
