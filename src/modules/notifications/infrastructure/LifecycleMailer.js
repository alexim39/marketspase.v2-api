import { appBaseUrl } from '../../../services/emailService.js';

const escapeHtml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Human fallback for names/labels so `${undefined}` can never reach a mail. */
const textOr = (value, fallback) => String(value ?? '').trim() || fallback;

/** Absolute app links — email clients can't resolve router-relative hrefs. */
const appLink = (path) => `${appBaseUrl()}${path}`;

const footer = (why) => `
  <p style="color:#888;font-size:12px;">${why} Change anytime in Notification settings.</p>
`;

const steps = (items) => `<ol>${items.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>`;

/**
 * Lifecycle email templates — pure builders (testable without a mailer).
 * Welcome, recruit-alert, promotion, goal and training-track mails are
 * lifecycle mail: always sent alongside the in-app row (delivery `force`
 * policy), never gated on marketing preferences.
 */
export const buildGoalRisk = ({ memberName, uplineName, title, remaining, daysLeft, requiredDaily }) => ({
  subject: `${textOr(memberName, 'A team member')}'s goal "${textOr(title, 'Goal')}" needs help — ${textOr(daysLeft, '?')}d left`,
  html: `
    <p>Hi ${escapeHtml(textOr(uplineName, 'Leader'))},</p>
    <p><strong>${escapeHtml(textOr(memberName, 'A team member'))}</strong> is off-track on <strong>${escapeHtml(textOr(title, 'Goal'))}</strong> with ${escapeHtml(textOr(daysLeft, '?'))} days left:</p>
    ${steps([
      `${escapeHtml(textOr(remaining, '?'))} still to go — about ${escapeHtml(textOr(requiredDaily, '?'))} per day to catch up.`,
      'Check in today: one honest conversation beats a week of hoping.',
      'Help them pick the single next action, not ten.',
    ])}
    <p><a href="${appLink('/dashboard/network/tree')}">View your team</a></p>
    ${footer('You get this because someone in your downline has a goal at risk.')}
  `,
});

export const buildGoalDone = ({ memberName, title }) => ({
  subject: `Goal smashed: "${textOr(title, 'your goal')}" — congratulations!`,
  html: `
    <p>Hi ${escapeHtml(textOr(memberName, 'there'))},</p>
    <p>You hit <strong>${escapeHtml(textOr(title, 'your goal'))}</strong>. Targets you keep are the ones that compound:</p>
    ${steps([
      'Set your next goal while the momentum is hot.',
      'Tell your upline — wins shared are wins doubled.',
    ])}
    <p><a href="${appLink('/dashboard/goals')}">Set your next goal</a></p>
    ${footer('You get this because you completed a goal.')}
  `,
});

export const buildContactListSubmitted = ({ memberName, uplineName, count }) => ({
  subject: `${textOr(memberName, 'A team member')} submitted a contact list (${textOr(count, '0')} contacts) — start calling`,
  html: `
    <p>Hi ${escapeHtml(textOr(uplineName, 'Leader'))},</p>
    <p><strong>${escapeHtml(textOr(memberName, 'A team member'))}</strong> just submitted their onboarding contact list with <strong>${escapeHtml(textOr(count, '0'))} contacts</strong>. Early calls book the sessions that build the business:</p>
    ${steps([
      `Start calling today — hottest relationships first.`,
      `Book sessions straight into their calendar and confirm the night before.`,
      `Mark each outcome in the pipeline so ${escapeHtml(textOr(memberName, 'A team member'))} sees progress.`,
    ])}
    <p><a href="${appLink('/dashboard/mentorship/team/contact-lists')}">Work their contact list</a></p>
    ${footer('You get this because someone in your downline submitted a contact list.')}
  `,
});

export const buildTrackComplete = ({ memberName }) => ({
  subject: `${textOr(memberName, 'Well done')}, your full training track is complete!`,
  html: `
    <p>Hi ${escapeHtml(textOr(memberName, 'there'))},</p>
    <p>IPO, QSG and SMO — all confirmed. That puts you in rare company:</p>
    ${steps([
      'Open My Journey to see what your training unlocked.',
      'Offer to walk a newer member through IPO — teaching locks in learning.',
    ])}
    <p><a href="${appLink('/dashboard/progress')}">View your journey</a></p>
    ${footer('You get this because you completed the full training track.')}
  `,
});

export const buildTrackCompleteUpline = ({ memberName, uplineName }) => ({
  subject: `${textOr(memberName, 'A team member')} finished the full training track — recognise them`,
  html: `
    <p>Hi ${escapeHtml(textOr(uplineName, 'Leader'))},</p>
    <p><strong>${escapeHtml(textOr(memberName, 'A team member'))}</strong> just completed IPO, QSG and SMO — all confirmed. Fully-trained members recruit and retain better:</p>
    ${steps([
      `Recognise ${textOr(memberName, 'this member')} publicly — Community shout-outs duplicate effort.`,
      'Point them at their next gate in your next 15-minute review.',
    ])}
    <p><a href="${appLink('/dashboard/network/tree')}">View your team</a></p>
    ${footer('You get this because someone in your downline finished training.')}
  `,
});
export const buildWelcome = ({ memberName }) => ({
  subject: `Welcome to MarketSpase, ${textOr(memberName, 'there')}! Here are your first steps`,
  html: `
    <p>Hi ${escapeHtml(textOr(memberName, 'there'))},</p>
    <p>Welcome aboard! Your MarketSpase journey has begun. Here is exactly what to do first:</p>
    ${steps([
      'Complete your profile — phone number and address, plus a photo so prospects recognise you.',
      'Take the IPO course in the Training Center — it unlocks your first promotion.',
      'Activate your online business, then create your first partner acquisition campaign.',
      'Set your first goal so your pace is tracked from day one.',
    ])}
    <p><a href="${appLink('/dashboard')}">Open your Daily Action Center</a></p>
    ${footer('You get this because you just joined MarketSpase.')}
  `,
});

export const buildRecruitAlert = ({ memberName, uplineName, source = 'referral', campaignName = '' }) => {
  const referral = source === 'referral';
  const member = textOr(memberName, 'A new partner');
  const placement = referral
    ? 'just signed up with the referral code you recorded'
    : `was allocated to your team${campaignName ? ` from the campaign <strong>${escapeHtml(campaignName)}</strong>` : ''}`;
  return {
    subject: referral
      ? `${member} just joined your team — here is what to do next`
      : `${member} was allocated to your team — here is what to do next`,
    html: `
    <p>Hi ${escapeHtml(textOr(uplineName, 'there'))},</p>
    <p>Great news — <strong>${escapeHtml(member)}</strong> ${placement}. New ${referral ? 'recruits' : 'partners'} activate fastest in their first 48 hours:</p>
    ${steps([
      `Call ${member} today — welcome them personally and answer first questions.`,
      'Schedule their onboarding session this week.',
      'Walk them through the IPO course and their first prospect list.',
      'Check their profile is complete so they are reachable.',
    ])}
    <p><a href="${appLink('/dashboard/team/handoffs')}">Open the new-member task</a></p>
    ${footer('You get this because someone joined your team.')}
  `,
  };
};

export const buildMentorBonusCredited = ({
  mentorName,
  memberName = '',
  amount,
  balanceAfter = null,
}) => {
  const amountLabel = Number(amount || 0).toLocaleString('en-NG');
  const balanceLabel = Number(balanceAfter || 0).toLocaleString('en-NG');
  const hasBalance = balanceAfter !== null && balanceAfter !== undefined && Number.isFinite(Number(balanceAfter));
  const reason = String(memberName ?? '').trim()
    ? `because <strong>${escapeHtml(memberName)}</strong> activated in your team`
    : 'because a new partner activated in your team';

  return {
    subject: `₦${amountLabel} mentor/coach bonus credited to your wallet`,
    html: `
    <p>Hi ${escapeHtml(textOr(mentorName, 'there'))},</p>
    <p>Your wallet has been credited with a <strong>₦${amountLabel}</strong> mentor/coach bonus ${reason}.</p>
    ${hasBalance ? `<p>New wallet balance: <strong>₦${balanceLabel}</strong>.</p>` : ''}
    <p><a href="${appLink('/dashboard/wallet/history')}">View wallet history</a></p>
    ${footer('You get this because a new partner activated in your team.')}
  `,
  };
};

export const buildPromotionMember = ({ memberName, toLabel }) => ({
  subject: `Congratulations — you reached ${textOr(toLabel, 'a new rank')}!`,
  html: `
    <p>Hi ${escapeHtml(textOr(memberName, 'there'))},</p>
    <p>You just reached <strong>${escapeHtml(textOr(toLabel, 'a new rank'))}</strong> on the MarketSpase journey. Take a moment — then keep climbing:</p>
    ${steps([
      'Open My Journey to see your next gate and readiness.',
      'Tell your upline — recognition fuels duplication.',
      'Set one goal that matches your new rank.',
    ])}
    <p><a href="${appLink('/dashboard/progress')}">View your journey</a></p>
    ${footer('You get this because you earned a promotion.')}
  `,
});

export const buildPromotionUpline = ({ memberName, toLabel, uplineName }) => ({
  subject: `${textOr(memberName, 'A team member')} just reached ${textOr(toLabel, 'a new rank')} — congratulate them`,
  html: `
    <p>Hi ${escapeHtml(textOr(uplineName, 'Leader'))},</p>
    <p><strong>${escapeHtml(textOr(memberName, 'A team member'))}</strong> from your team just reached <strong>${escapeHtml(textOr(toLabel, 'a new rank'))}</strong>. Leaders who recognise promotion promptly duplicate faster:</p>
    ${steps([
      `Call or message ${textOr(memberName, 'this member')} today — public recognition in the Community multiplies the effect.`,
      'Review their next gate together in your next 15-minute review.',
      'Ask who they are developing behind them — leaders build leaders.',
    ])}
    <p><a href="${appLink('/dashboard/network/tree')}">View your team</a></p>
    ${footer('You get this because someone in your downline earned a promotion.')}
  `,
});

export const buildTrainingRequest = ({ memberName, uplineName, keyLabel }) => ({
  subject: `${textOr(memberName, 'A team member')} completed ${textOr(keyLabel, 'training')} — please confirm`,
  html: `
    <p>Hi ${escapeHtml(textOr(uplineName, 'Leader'))},</p>
    <p><strong>${escapeHtml(textOr(memberName, 'A team member'))}</strong> marked <strong>${escapeHtml(textOr(keyLabel, 'training'))}</strong> as complete and is waiting on your confirmation to unlock their next gate:</p>
    ${steps([
      `Confirm ${textOr(keyLabel, 'this training')} on the training confirmations page if they genuinely completed it.`,
      'If not yet, decline with a clear reason so they know what remains.',
      'Use the moment — a quick call here compounds into momentum.',
    ])}
    <p><a href="${appLink('/dashboard/mentorship/team/confirmations')}">Review pending confirmations</a></p>
    ${footer('You get this because someone in your downline needs your confirmation.')}
  `,
});

export const buildTrainingOutcome = ({ memberName, keyLabel, approved, note }) => ({
  subject: approved
    ? `Your ${textOr(keyLabel, 'training')} is confirmed — well done!`
    : `Your ${textOr(keyLabel, 'training')} needs a little more — see why`,
  html: approved
    ? `
    <p>Hi ${escapeHtml(textOr(memberName, 'there'))},</p>
    <p>Thank you for taking the next step — your upline has confirmed your <strong>${escapeHtml(textOr(keyLabel, 'training'))}</strong> completion. Your journey progress is updated:</p>
    ${steps([
      'Open My Journey to see your next requirement.',
      'Keep the streak — book your next training or action today.',
    ])}
    <p><a href="${appLink('/dashboard/progress')}">View your journey</a></p>
    ${footer('You get this because your training was confirmed.')}
  `
    : `
    <p>Hi ${escapeHtml(textOr(memberName, 'there'))},</p>
    <p>Thank you for taking the next step. Your upline reviewed your <strong>${escapeHtml(textOr(keyLabel, 'training'))}</strong> and feels it is not quite complete yet. Their reason:</p>
    <blockquote>${escapeHtml(note) || 'No reason given — please ask your upline directly.'}</blockquote>
    <p>Finish the outstanding part and mark it done again — your upline will be notified.</p>
    <p><a href="${appLink('/dashboard/progress')}">Back to your journey</a></p>
    ${footer('You get this because your training review needs another pass.')}
  `,
});

export const buildDormantNudge = ({ memberName, daysAway }) => ({
  subject: `${textOr(memberName, 'Hi there')}, your business missed you — pick up where you left off`,
  html: `
    <p>Hi ${escapeHtml(textOr(memberName, 'there'))},</p>
    <p>It has been ${escapeHtml(textOr(daysAway, '?'))} days since you last signed in to MarketSpase. Your pipeline, team and goals are exactly where you left them — one session gets you moving again:</p>
    ${steps([
      'Open your Daily Action Center and do the top item only.',
      'Follow up with one prospect today — fortune lives in the follow-up.',
      'Finish one training lesson to keep your promotion gates unlocking.',
    ])}
    <p><a href="${appLink('/partner/signin')}">Sign back in</a></p>
    ${footer('You get this because your account has been inactive.')}
  `,
});
