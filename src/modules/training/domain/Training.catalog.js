import { ValidationException } from '../../../shared/domain/AppError.js';

/**
 * Course catalog — the takable IPO / QSG / SMO / Leadership path.
 * Content lives here (versioned with code); progress lives in Mongo.
 * Completing a ladder course auto-checks its progression milestone.
 */

const lesson = (id, title, body, takeaways = [], quiz = [], videoUrl = null, opts = {}) => ({
  id,
  title,
  body,
  takeaways,
  quiz,
  videoUrl,
  posterUrl: opts.posterUrl ?? null,
  captionsUrl: opts.captionsUrl ?? null,
  transcript: opts.transcript ?? null,
  durationSec: opts.durationSec ?? null,
});

export const COURSES = [
  {
    id: 'ipo',
    title: 'Initial Planning Orientation (IPO)',
    tagline: 'Understand the business before you run it.',
    milestone: 'ipo',
    lessons: [
      lesson(
        'ipo-1',
        'What Diamond Project is',
        'Diamond Project is a network marketing business: you earn by selling products and by building a team that sells products. There is no salary and no shortcut — income follows value created. Your first job is to understand the compensation plan at a level where you could explain it on a whiteboard in five minutes.',
        ['Income follows value, not tenure', 'Learn the plan cold before recruiting'],
        [
          { q: 'How do you earn in Diamond Project?', options: ['Salary from the company', 'Selling products and building a team that sells', 'Only by recruiting without selling'], answer: 1 },
          { q: 'What must you be able to explain before recruiting?', options: ['The office layout', 'The compensation plan in 5 minutes', 'Your sponsor’s title'], answer: 1 },
        ],
        '/courses/ipo/ipo-first-lesson-by-Prof-BB-July-2026.mp4',
        {
          captionsUrl: '/courses/ipo/ipo-1.vtt',
          durationSec: 2445,
          transcript: 'TRANSCRIPT — What Diamond Project is (Prof. BB, July 2026). Diamond Project is a network marketing business: you earn by selling products and by building a team that sells products. There is no salary and no shortcut — income follows value created. Your first job is to understand the compensation plan at a level where you could explain it on a whiteboard in five minutes. Key points: income follows value, not tenure; learn the plan cold before recruiting.',
        },
      ),
      lesson(
        'ipo-2',
        'How commissions flow',
        'Every product order can accrue commissions up the referral chain — this is the financial architectural blueprint: every contributor, from the seller to the mentors above, is rewarded according to the plan. Entries start Pending when an order lands and become Released when approved; Voided or Reversed entries are clawed back. Your ledger in the app is the single source of truth — check it weekly, keep your account qualified with monthly maintenance, and never let a gap break compounding for your whole downline.',
        ['Pending → Released → Paid is the lifecycle', 'Every contributor up the chain is rewarded', 'Your ledger is auditable — check it weekly'],
        [
          { q: 'A new order’s commission starts as…', options: ['Released', 'Pending', 'Reversed'], answer: 1 },
          { q: 'Where is the single source of truth for commissions?', options: ['Your ledger in the app', 'Word of mouth', 'A spreadsheet'], answer: 0 },
          { q: 'A Released commission means the order is…', options: ['Approved and payable', 'Still waiting', 'Cancelled'], answer: 0 },
          { q: 'Voided or reversed entries are…', options: ['Clawed back', 'Doubled as bonus', 'Ignored forever'], answer: 0 },
          { q: 'Commissions accrue…', options: ['Up the referral chain', 'Only to the company', 'Only to the top earner'], answer: 0 },
          { q: 'How often should you check your ledger?', options: ['Weekly', 'Yearly', 'Never'], answer: 0 },
          { q: 'A Pending entry becomes Released when…', options: ['The order is approved', 'You ask your upline', 'The month ends'], answer: 0 },
          { q: 'Who earns from a sale you make?', options: ['You and the mentors above you, per the plan', 'Only you', 'Only the admin'], answer: 0 },
          { q: 'Monthly maintenance keeps…', options: ['Your account qualified and your team paid', 'Nothing important', 'Only your badge'], answer: 0 },
          { q: 'Missing a maintenance month affects…', options: ['Only you', 'Your whole downline’s compounding', 'Nobody'], answer: 1 },
          { q: 'The blueprint is fair because…', options: ['Every contributor is rewarded by the plan', 'The top takes everything', 'Rewards are random'], answer: 0 },
          { q: 'A clawback happens when an order is…', options: ['Voided or reversed', 'Delivered quickly', 'Logged in the CRM'], answer: 0 },
          { q: 'The best proof of what you earned is…', options: ['Your ledger entries', 'Screenshots from others', 'Verbal promises'], answer: 0 },
          { q: 'Your downline’s sales pay you when…', options: ['Your account is qualified and active', 'Always, no matter what', 'Never'], answer: 0 },
          { q: 'If a commission looks wrong, you should…', options: ['Check your ledger and ask your upline', 'Ignore it silently', 'Edit the ledger yourself'], answer: 0 },
        ],
        '/courses/ipo/FINANCIAL-ARCHITECTURAL-BLUEPRINT-GODS-WAY.mp4',
        {
          durationSec: 2764,
          transcript: 'TRANSCRIPT — How commissions flow (Financial Architectural Blueprint, God’s Way). Every product order can accrue commissions up the referral chain: the seller earns, and the mentors above earn according to the compensation plan — no one’s effort goes unrewarded. When an order lands, its commission entry starts as Pending. When the order is approved, the entry becomes Released and payable. If an order is voided or reversed, the entry is clawed back. Your ledger inside the app is the single source of truth: review it weekly. Keep your account qualified with monthly maintenance, because one gap breaks compounding for your whole downline. Key points: Pending becomes Released on approval; voided entries are clawed back; the ledger is auditable; stay qualified every month.',
        },
      ),
      lesson(
        'ipo-3',
        'Your first 30 days',
        'Welcome home, partner — you made the right decision, and you are not walking this road alone. Feeling excited and nervous at the same time is completely normal; every leader you admire, every Kingsman on that stage, started exactly where you are now, with the same butterflies and the same questions. You already did the hardest part, which was starting. The diamond in you is waiting to shine, and the next 30 days are simply about cutting the first facets — small, simple, visible basics, done daily.\n\nWeek one is foundation week: finish this IPO orientation and the Quick Start Guide, set up your profile and landing page, write down 50 prospects, and book your onboarding session with your upline. Your upline is your coach, not your boss — lean on them shamelessly, ask every “silly” question, and let them sit in on your first presentations. Do not wait until you feel ready; readiness comes from action, not before it.\n\nWeeks two to four are rhythm weeks, and rhythm is how you succeed here. Present the opportunity every single day, follow up warmly, and log every touch in the CRM — presented, interested, follow-up required. Attend the weekly team training without fail, review your numbers against your calendar, and keep your contact list growing faster than your excuses. Success in network marketing is not talent; it is basics, repeated daily, in front of witnesses.\n\nConsistency is the whole secret, and consistency is a design choice, not a mood. Decide your business hours, guard them like appointments, and let discipline carry the days motivation skips — that stoic steadiness is the second pillar of this project for a reason. Track your streaks: presentations made, follow-ups kept, touches logged. Momentum in month one predicts year one, because a calendar full of small wins compounds into a business, while waiting for inspiration compounds into nothing.\n\nYou will hear “no” — and a “no” today is not a “no” forever, it is redirection, not rejection. Thank every prospect, note the follow-up date, and move on to the next conversation; the fortune lives in warm, honest follow-up. On the hard days, do not go silent — silence is the only real failure here. Call your upline, show up to training, borrow belief until your own results arrive. Duplication starts with you being duplicable: do the simple things so visibly that your first recruit can copy you without a manual.\n\nAt day 30, stop and look back: orientation done, 50 names listed, daily presenting habit alive, first touches logged, training attended, upline relationship strong. That version of you is already unrecognizable from day one — and it is only the first facet. Hold the rhythm for 90 days and you will not just understand this business, you will be becoming the ultimate version of yourself. One year from now, you will be so glad you started today. Welcome to Diamond Project — now go shine.',
        ['You belong here — every leader started where you are', '50-prospect list in week one', 'Present daily, log everything, lean on your upline'],
        [
          { q: 'Week-one target for prospects listed?', options: ['10', '50', '200'], answer: 1 },
          { q: 'Weeks 2–4 daily habit?', options: ['Present daily and log every touch', 'Wait for inbound leads', 'Only follow up on Mondays'], answer: 0 },
          { q: 'What should a new partner finish first?', options: ['IPO and Quick Start orientation', 'Buying paid ads', 'Recruiting ten people'], answer: 0 },
          { q: 'Feeling nervous as a beginner is…', options: ['Completely normal — every leader felt it', 'A sign you should quit', 'Proof this business is not for you'], answer: 0 },
          { q: 'Your upline is best described as…', options: ['Your coach — lean on them', 'Your boss who gives orders', 'Irrelevant to your success'], answer: 0 },
          { q: 'What should you do when you feel stuck?', options: ['Ask your upline and attend the weekly training', 'Go silent for a month', 'Quit quietly'], answer: 0 },
          { q: 'A “no” from a prospect means…', options: ['Not now — keep following up warmly', 'You have failed', 'Never contact them again'], answer: 0 },
          { q: 'Momentum in month one predicts…', options: ['Year one', 'Nothing at all', 'Only your mood'], answer: 0 },
          { q: 'Duplication starts when you…', options: ['Do the simple basics visibly', 'Earn big first', 'Work alone'], answer: 0 },
          { q: 'Your first presentations should be…', options: ['Done with your upline sitting in', 'Delayed until you feel perfect', 'Done only over text'], answer: 0 },
        ],
        '/courses/ipo/The-First-Step-For-Network-Marketing-Success.mp4',
        {
          durationSec: 545,
          transcript: 'TRANSCRIPT — Your first 30 days (The First Step for Network Marketing Success). Welcome home, partner. You made the right decision, and you are not alone on this journey. Week one: complete your IPO and Quick Start orientation, list 50 prospects, and book your onboarding session with your upline. Weeks two to four: present daily, follow up with warmth, and record every touch in the CRM. Nervousness is normal. Rejection is redirection. Lean on your coach, attend every training, and keep the rhythm — present, follow up, log, repeat. Momentum now compounds into the ultimate version of yourself.',
        },
      ),
    ],
  },
  {
    id: 'qsg',
    title: 'Quick Start Guide (QSG)',
    tagline: 'Your first recruit in 14 days.',
    milestone: 'qsg',
    lessons: [
      lesson(
        'qsg-1',
        'Set up your tools',
        'Video lesson in production — the video version of this lesson is being recorded and will appear here automatically. The written lesson below covers everything needed for certification.\n\nComplete your profile, set your landing page, and learn the pipeline board. Every prospect goes in the CRM the day you meet them — memory is not a system. Connect your contact list and import leads where the app allows it.',
        ['CRM entry on first contact', 'Profile and landing page live', 'Know your pipeline stages before inviting'],
        [
          { q: 'When does a prospect enter the CRM?', options: ['At month-end', 'The day you meet them', 'Only when they buy'], answer: 1 },
          { q: 'What powers your landing page?', options: ['Your completed profile', 'Random generator', 'Admin approval only'], answer: 0 },
          { q: 'Why enter prospects the same day?', options: ['Memory is not a system — details fade', 'The app deletes old entries', 'Uplines require it daily'], answer: 0 },
          { q: 'Before inviting, you should know…', options: ['Every pipeline stage by name', 'Your sponsor’s bank balance', 'Nothing — just start'], answer: 0 },
        ],
        null,
        {
          transcript: 'TRANSCRIPT — Set up your tools (Quick Start Guide). Before you invite a single person, set up your tools. First, complete your profile: photo, phone, location — this powers your public landing page, the page your prospects will judge you on. Second, open the pipeline board and learn the stages: New, Contacted, Interested, In Negotiation, Converted. Every prospect you meet goes into the CRM the same day, with a phone number and a next action. Memory is not a system. Third, connect your contact list and import leads where the app allows it. Tools set up once pay you daily — skip this and you will spend month one apologizing instead of recruiting.',
        },
      ),
      lesson(
        'qsg-2',
        'The invitation',
        'Video lesson in production — the video version of this lesson is being recorded and will appear here automatically. The written lesson below covers everything needed for certification.\n\nInvite with curiosity, not pressure: share what you started, offer a 15-minute look, and book a specific time. Track every invitation outcome in the activity timeline — Contacted, Interested, or Follow-Up Required. No outcome, no progress.',
        ['Book specific times, never "sometime"', 'Log the outcome every time', 'Curiosity opens, pressure closes'],
        [
          { q: 'How should you invite?', options: ['With pressure and urgency', 'With curiosity, offer a 15-minute look', 'By sending the price list'], answer: 1 },
          { q: 'An invitation logged without outcome is…', options: ['Enough to count', 'No progress', 'Auto-advanced'], answer: 1 },
          { q: 'Why a specific time instead of "sometime"?', options: ['Vague plans die — calendars commit', 'It sounds more professional only', 'It does not matter'], answer: 0 },
          { q: 'The 15-minute offer works because it is…', options: ['Low pressure and easy to accept', 'Long enough to close', 'Required by policy'], answer: 0 },
        ],
        null,
        {
          transcript: 'TRANSCRIPT — The invitation (Quick Start Guide). The invitation is not the presentation — never confuse the two. Your only job is to book a look: share what you started in one sentence, offer a 15-minute look at the opportunity, and propose a specific date and time. Never "let us talk sometime" — sometime means never. After every invitation, log the outcome in the activity timeline that same hour: Contacted, Interested, or Follow-Up Required with a date. An invitation without a logged outcome did not happen. Invitations are a numbers game played with warmth: ten curious invites a week beats one perfect pitch a month.',
        },
      ),
      lesson(
        'qsg-3',
        'Present and close',
        'Video lesson in production — the video version of this lesson is being recorded and will appear here automatically. The written lesson below covers everything needed for certification.\n\nPresent the opportunity, handle the two real objections (time and money) with stories not arguments, and ask for the decision. Stuck prospects get a follow-up date, never silence. Move every Ready To Join prospect to conversion the same day.',
        ['Ask for the decision explicitly', 'Convert the same day', 'Stories beat arguments on objections'],
        [
          { q: 'How to handle time/money objections?', options: ['Stories, not arguments', 'Ignore them', 'Lower the price'], answer: 0 },
          { q: 'A Ready-To-Join prospect should be converted…', options: ['Next month', 'The same day', 'After 3 follow-ups'], answer: 1 },
          { q: 'A stuck prospect gets…', options: ['Silence until they return', 'A follow-up date, never silence', 'Removed from the CRM'], answer: 1 },
          { q: 'Why ask for the decision explicitly?', options: ['Unasked prospects drift — clarity respects them', 'It pressures them correctly', 'It is optional'], answer: 0 },
        ],
        null,
        {
          transcript: 'TRANSCRIPT — Present and close (Quick Start Guide). Present the opportunity simply: the problem, the vehicle, the first step. When time or money objections come — and only those two are real — answer with stories, not arguments: who started busier than them, who started broker than them. Then ask for the decision plainly: "Are you ready to start with me today?" If yes, convert them the same day — delay kills decisions. If not yet, never leave them in silence: agree a specific follow-up date and log it. A pipeline with dates is a business; a pipeline with maybes is a hobby.',
        },
      ),
      lesson(
        'qsg-4',
        'Onboard your recruit',
        'Video lesson in production — the video version of this lesson is being recorded and will appear here automatically. The written lesson below covers everything needed for certification.\n\nA recruit without onboarding is a future dropout. Walk them through IPO, help them list their 50, and sit in on their first three presentations. Duplication starts with you being duplicable.',
        ['Onboard within 48 hours', 'Attend their first three presentations', 'Teach only what you do yourself'],
        [
          { q: 'Duplication starts when you…', options: ['Skip onboarding', 'Are duplicable — attend their first three presentations', 'Hand them a PDF'], answer: 1 },
          { q: 'When to onboard a new recruit?', options: ['Within 48 hours', 'After a month', 'Only if they ask'], answer: 0 },
          { q: 'Why sit in on their first three presentations?', options: ['To model the skill live — people copy what they see', 'To close for them permanently', 'It is not necessary'], answer: 0 },
          { q: 'A recruit’s first deliverable with you is…', options: ['Their 50-prospect list', 'A product order only', 'A testimonial'], answer: 0 },
        ],
        null,
        {
          transcript: 'TRANSCRIPT — Onboard your recruit (Quick Start Guide). Signing a recruit is the start, not the finish: an unonboarded recruit is a future dropout. Within 48 hours, walk them through IPO, help them write their 50-prospect list, and set up their tools exactly like yours. Then sit in on their first three presentations — not to take over, but to model. People duplicate what they see, not what they are told. Teach only habits you practice yourself. Your recruit’s speed in week one predicts their year one, and your attendance at their first presentations is the highest-leverage hour in this business.',
        },
      ),
    ],
  },
  {
    id: 'smo',
    title: 'Standard Method of Operation (SMO)',
    tagline: 'The weekly rhythm that compounds.',
    milestone: 'smo',
    lessons: [
      lesson(
        'smo-1',
        'The non-negotiable week',
        'Video lesson in production — the video version of this lesson is being recorded and will appear here automatically. The written lesson below covers everything needed for certification.\n\nEvery active week contains the same blocks: 5 presentations, 10 follow-ups, 1 team training, ledger review, and goal check-in. The method is standard so results are comparable — if your numbers lag, the calendar tells you why before your upline has to.',
        ['Same blocks every week', 'The calendar diagnoses slumps', 'Protect the blocks like appointments'],
        [
          { q: 'An active week contains…', options: ['Random tasks', 'Same blocks: 5 presents, 10 follow-ups, training, ledger, goals', 'Only product orders'], answer: 1 },
          { q: 'When numbers lag, what diagnoses it?', options: ['Your upline’s mood', 'Your calendar', 'Luck'], answer: 1 },
          { q: 'Why must the method be standard?', options: ['So results are comparable across the team', 'To make it boring', 'It is optional'], answer: 0 },
          { q: 'Skipping the ledger review means…', options: ['Flying blind on money', 'Saving time wisely', 'Nothing'], answer: 0 },
        ],
        null,
        {
          transcript: 'TRANSCRIPT — The non-negotiable week (Standard Method of Operation). Amateurs negotiate with their calendar weekly; professionals repeat the same blocks: five presentations, ten follow-ups, one team training, a ledger review, and a goal check-in. Same blocks, every week, no debate. The method is standard across the whole project so results are comparable — when two partners run the same blocks and get different numbers, the difference is skill, and skill can be coached. When your numbers lag, open your calendar before you call your upline: the missing block is always visible. Protect these blocks like client appointments, because they are appointments — with your future.',
        },
      ),
      lesson(
        'smo-2',
        'Maintenance and compliance',
        'Video lesson in production — the video version of this lesson is being recorded and will appear here automatically. The written lesson below covers everything needed for certification.\n\nMonthly personal maintenance keeps your accounts qualified and your team paid. Review product maintenance history in the app, keep at least the required accounts active, and never let a month slip silently — one gap breaks compounding for your whole downline.',
        ['Never miss a maintenance month', 'Your gap costs your team too', 'Record DTC evidence for upline confirmation'],
        [
          { q: 'Missing a maintenance month affects…', options: ['Only you', 'Your whole downline’s compounding', 'Nobody'], answer: 1 },
          { q: 'How often to review maintenance?', options: ['Monthly', 'Yearly', 'Never'], answer: 0 },
          { q: 'If you maintain via DTC, you must…', options: ['Record the receipt as evidence for upline confirmation', 'Keep it to yourself', 'Skip the month'], answer: 0 },
          { q: 'Shop orders count toward maintenance…', options: ['Automatically — no form needed', 'Only after upline approval', 'Never'], answer: 0 },
        ],
        null,
        {
          transcript: 'TRANSCRIPT — Maintenance and compliance (Standard Method of Operation). Monthly maintenance is the membership fee of compounding: it keeps your accounts qualified and your downline paid. Review your maintenance history in the app every month — shop orders count automatically. If you maintain through DTC, record the receipt as evidence in My Journey so your upline can confirm it. Three maintained accounts is the Kingsman bar. Never let a month slip silently: one quiet gap breaks compounding for everyone below you, and trust, once broken over money rhythm, is slow to rebuild.',
        },
      ),
      lesson(
        'smo-3',
        'Leading by the method',
        'Video lesson in production — the video version of this lesson is being recorded and will appear here automatically. The written lesson below covers everything needed for certification.\n\nKingsmen run SMO visibly: post your numbers, hold the weekly training, and inspect your leaders’ calendars kindly. The standard only works when leaders submit to it first. Recognition follows consistency, not intensity.',
        ['Run it visibly', 'Inspect kindly, consistently', 'Never ask what you do not do'],
        [
          { q: 'Who must submit to the standard first?', options: ['Leaders', 'Only new partners', 'No one'], answer: 0 },
          { q: 'Recognition follows…', options: ['Intensity', 'Consistency', 'Seniority alone'], answer: 1 },
          { q: 'Posting your numbers publicly does what?', options: ['Gives permission — the team copies visible habits', 'Shows off', 'Nothing'], answer: 0 },
          { q: 'Inspecting calendars kindly means…', options: ['Weekly review with care, not blame', 'Ignoring slumps', 'Public shaming'], answer: 0 },
        ],
        null,
        {
          transcript: 'TRANSCRIPT — Leading by the method (Standard Method of Operation). The standard holds only if leaders submit to it first. A Kingsman posts his own numbers before asking anyone else’s, holds the weekly training whether five attend or fifty, and inspects his leaders’ calendars kindly — weekly, with care, never with blame. People do what leaders do, not what leaders say. Intensity impresses for a week; consistency compounds for a career. Recognition in this project follows consistency, not intensity — run the method visibly and the rank takes care of itself.',
        },
      ),
    ],
  },
  {
    id: 'leadership',
    title: 'Leadership Development',
    tagline: 'From Kingsman to Cell Leader.',
    milestone: null,
    lessons: [
      lesson(
        'leadership-1',
        'Raising Kingsmen',
        'Video lesson in production — the video version of this lesson is being recorded and will appear here automatically. The written lesson below covers everything needed for certification.\n\nYou do not promote people; you develop them until promotion is obvious. Each emerging leader needs a goal, a calendar, and a weekly review with you. Track their journey stages the way you track prospects — leadership is a pipeline too.',
        ['Develop until promotion is obvious', 'Weekly reviews, no exceptions', 'Leadership is a pipeline — track it'],
        [
          { q: 'Promotion should feel…', options: ['Sudden', 'Obvious after development', 'Based on tenure alone'], answer: 1 },
          { q: 'Each emerging leader needs…', options: ['A goal, a calendar, and a weekly review', 'Just a title', 'Monthly check-ins only'], answer: 0 },
          { q: 'Tracking journey stages like prospects works because…', options: ['Leadership growth is a pipeline with visible stages', 'It fills the CRM', 'Uplines demand it'], answer: 0 },
          { q: 'Skipping weekly reviews causes…', options: ['Faster growth', 'Drift you discover too late', 'Nothing'], answer: 1 },
        ],
        null,
        {
          transcript: 'TRANSCRIPT — Raising Kingsmen (Leadership Development). You do not promote people; you develop them until promotion is obvious to everyone. Each emerging leader under you needs three things: a written goal, a calendar with business blocks, and a weekly review with you — no exceptions, no skipped weeks. Track their journey stages the way you track prospects in the pipeline: who needs IPO confirmed, who needs their fifth active, who is stalled. Leadership is a pipeline too, and pipelines you inspect weekly move. Your job is not to be the hero of their story but the coach who makes heroes obvious.',
        },
      ),
      lesson(
        'leadership-2',
        'Running a cell',
        'Video lesson in production — the video version of this lesson is being recorded and will appear here automatically. The written lesson below covers everything needed for certification.\n\nA cell runs on three meetings: weekly training, monthly recognition, quarterly planning. Keep each under an hour, start on time, end with assignments. Culture is what repeats — design the repetition deliberately.',
        ['Three meetings, each under an hour', 'End with assignments', 'Start on time, every time'],
        [
          { q: 'A cell runs on how many recurring meetings?', options: ['One', 'Three: weekly, monthly, quarterly', 'Ten'], answer: 1 },
          { q: 'Each meeting should…', options: ['Run 3+ hours', 'Stay under an hour and end with assignments', 'Have no agenda'], answer: 1 },
          { q: 'Starting late teaches the cell that…', options: ['Time is flexible here', 'Punctuality matters', 'Nothing'], answer: 0 },
          { q: 'Monthly recognition exists to…', options: ['Celebrate progress publicly and reinforce the culture', 'Fill the calendar', 'Rank members'], answer: 0 },
        ],
        null,
        {
          transcript: 'TRANSCRIPT — Running a cell (Leadership Development). A cell runs on exactly three recurring meetings: weekly training for skill, monthly recognition for culture, quarterly planning for direction. Keep each under an hour, start on time to the minute, and end with named assignments — a meeting without assignments was entertainment. Culture is not what you declare; it is what repeats. Design the repetition deliberately: same rhythms, same standards, same warmth, until new members absorb the culture without being taught it. Boring consistency at the top creates exciting growth at the bottom.',
        },
      ),
      lesson(
        'leadership-3',
        'Succession and scale',
        'Video lesson in production — the video version of this lesson is being recorded and will appear here automatically. The written lesson below covers everything needed for certification.\n\nYour cell outgrows you exactly when your leaders no longer need you in the room. Document the method, hand over the training rotation, and measure yourself by leaders raised, not recruits signed. That is the whole game above Kingsman.',
        ['Measure leaders raised', 'Document, then delegate', 'Success is a room that works without you'],
        [
          { q: 'Above Kingsman you measure yourself by…', options: ['Recruits signed', 'Leaders raised', 'Messages sent'], answer: 1 },
          { q: 'Scaling requires…', options: ['More hours from you', 'Documenting and delegating the training rotation', 'Random assignments'], answer: 1 },
          { q: 'Handing over the training rotation proves…', options: ['Your leaders can carry the method alone', 'You are tired', 'Training is finished'], answer: 0 },
          { q: 'A leader who is still the bottleneck should…', options: ['Document more and delegate sooner', 'Work longer hours', 'Recruit faster'], answer: 0 },
        ],
        null,
        {
          transcript: 'TRANSCRIPT — Succession and scale (Leadership Development). The final test of leadership is absence: your cell outgrows you exactly when your leaders no longer need you in the room. Get there by documenting the method so it survives without your memory, then handing over the training rotation one slot at a time. Above Kingsman, stop counting recruits and start counting leaders raised — that is the whole game. If growth still depends on your personal hours, you have not scaled, you have just worked harder. Build the room that works without you, and you have built an organization.',
        },
      ),
    ],
  },
];

export const getCourse = (id) => {
  const course = COURSES.find((c) => c.id === id);
  if (!course) throw new ValidationException('Unknown course');
  return course;
};

export const getCourseWithQuizFull = async (id, training) => {
  const course = getCourse(id);
  if (!training?.getQuiz && !training?.getMedia) return course;
  const withQuiz = await Promise.all(course.lessons.map(async (l) => {
    const override = typeof training.getQuiz === 'function'
      ? await training.getQuiz(course.id, l.id).catch(() => null)
      : null;
    return override ? { ...l, quiz: override } : l;
  }));
  // Media overrides win field-by-field; null/empty falls back to catalog.
  const withMedia = await Promise.all(withQuiz.map(async (l) => {
    const media = typeof training.getMedia === 'function'
      ? await training.getMedia(course.id, l.id).catch(() => null)
      : null;
    if (!media) return l;
    return {
      ...l,
      ...(media.videoUrl ? { videoUrl: media.videoUrl } : {}),
      ...(media.posterUrl ? { posterUrl: media.posterUrl } : {}),
      ...(media.captionsUrl ? { captionsUrl: media.captionsUrl } : {}),
      ...(media.transcript ? { transcript: media.transcript } : {}),
      ...(media.body ? { body: media.body } : {}),
      ...(Array.isArray(media.takeaways) && media.takeaways.length > 0 ? { takeaways: media.takeaways } : {}),
      ...(media.durationSec !== undefined && media.durationSec !== null ? { durationSec: media.durationSec } : {}),
    };
  }));
  return { ...course, lessons: withMedia };
};

/** Public course payload — quiz answers are stripped EXCEPT for lessons
 * whose ids are in `revealFor` (completed lessons: nothing left to cheat,
 * everything to study). Server re-validates on submit regardless. */
export const getCourseWithQuiz = async (id, training, revealFor = []) => {
  const course = await getCourseWithQuizFull(id, training);
  const revealed = new Set(revealFor ?? []);
  return {
    ...course,
    lessons: course.lessons.map((l) => ({
      ...l,
      quiz: (l.quiz ?? []).map((q) => revealed.has(l.id)
        ? { q: q.q, options: q.options, answer: q.answer }
        : { q: q.q, options: q.options }),
    })),
  };
};

export const getLessonWithQuiz = async (courseId, lessonId, training) => {
  const course = await getCourseWithQuizFull(courseId, training);
  const lessonEntry = course.lessons.find((l) => l.id === lessonId);
  if (!lessonEntry) throw new ValidationException('Unknown lesson');
  return { course, lesson: lessonEntry };
};

export const getLesson = (courseId, lessonId) => {
  const course = getCourse(courseId);
  const lessonEntry = course.lessons.find((l) => l.id === lessonId);
  if (!lessonEntry) throw new ValidationException('Unknown lesson');
  return { course, lesson: lessonEntry };
};

/**
 * Pure progress math — unit-testable without Mongo.
 * Unknown ids in `completed` are ignored (catalog may grow).
 */
export const courseProgress = (course, completedIds = []) => {
  const known = new Set(course.lessons.map((l) => l.id));
  const done = [...new Set(completedIds)].filter((id) => known.has(id));
  return {
    done: done.length,
    total: course.lessons.length,
    percent: course.lessons.length > 0 ? Math.round((done.length / course.lessons.length) * 100) : 100,
    certified: done.length === course.lessons.length && course.lessons.length > 0,
    completedIds: done,
  };
};

export const catalogSummaries = () => COURSES.map(({ id, title, tagline, milestone, lessons }) => ({
  id, title, tagline, milestone, lessons: lessons.length,
}));
