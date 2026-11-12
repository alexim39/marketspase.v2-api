import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { TrainingCourseModel, TrainingLessonModel } from '../src/modules/training/infrastructure/Training.models.js';
import { MongoAuditStore } from '../src/modules/audit/infrastructure/Audit.store.js';

/**
 * Seed the remaining three core Academy courses: QSG, SMO and Leadership.
 * Idempotent by course milestone/title and lesson title. Videos are public
 * YouTube links; the admin can replace them later in Training Studio.
 */

const youtube = (id) => ({
  youtubeId: id,
  youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
});

const COURSES = [
  {
    title: 'Quick Start Guide (QSG)',
    tagline: 'From first conversation to your first recruit — the first 14 days.',
    description:
      'QSG turns your IPO foundation into action. You will set up your working tools, learn a respectful invitation, present and follow up with confidence, and onboard your first recruit so the system can duplicate. Complete all four lessons and pass each quiz. Your QSG rank training is recorded automatically.',
    milestone: 'qsg',
    sortOrder: 1,
    coverUrl: 'https://i.ytimg.com/vi/WI9Xhxh__zY/hqdefault.jpg',
    lessons: [
      {
        title: 'Set up your business cockpit',
        summary: 'Your profile, landing page, CRM and 50-name list — the working tools for week one. Video: Eric Worre.',
        youtubeId: 'WI9Xhxh__zY',
        durationSec: 540,
        body: `A business needs a cockpit before it needs a crowd. Your cockpit is the small set of tools you will use every day: a complete profile, a working public page, a pipeline that records every conversation, and a calendar that protects the time to do the work.

Complete your profile and landing page first. Use a current photo, a clear description of who you help, a working phone number and the correct public link. When a prospect checks you, the page should answer one question: can I trust this person enough to have a conversation?

Next, learn the pipeline. Every person you meet goes into the CRM the same day with their source, current stage and next action. Memory is not a system. The pipeline is how you keep promises, avoid duplicate follow-ups and see where conversations stall.

Build your 50-name list without pre-judging anyone. Think about customers who may need the products, people who may be open to a side business, and connectors who know many people. The list is a starting point for service and conversation, not a list of people to pressure.

Finally, design week one. Block time for learning, conversations, follow-ups and team training. Start on time. Respect consent and privacy: no bulk unsolicited messages, no spam and no pressure. A calm, organised start is easier for your future recruit to copy.`,
        takeaways: [
          'Your cockpit is profile, public page, CRM and calendar.',
          'Every contact enters the pipeline the same day with a next action.',
          'The 50-name list is for service and conversation, not pressure.',
          'Protect week-one time and respect consent from the first message.',
        ],
        transcript:
          'Video summary (not verbatim) — Eric Worre explains why starting on time matters: schedule the business, keep appointments, and treat the work like a profession. The lesson applies that to MarketSpase by setting up the profile, landing page, CRM, 50-name list and a realistic week-one calendar.',
        quiz: [
          { q: 'What belongs in your business cockpit?', options: ['Profile, public page, CRM and calendar', 'Only a WhatsApp broadcast list', 'A paid-ad account'], answer: 0 },
          { q: 'When should a new contact enter the CRM?', options: ['At the end of the month', 'The same day you meet them', 'Only after they buy'], answer: 1 },
          { q: 'What is the 50-name list for?', options: ['Pressuring everyone to join', 'Starting respectful service and conversations', 'Sending one bulk message'], answer: 1 },
          { q: 'Which behaviour protects your reputation?', options: ['Bulk unsolicited messages', 'Respecting consent and logging a next action', 'Posting income promises'], answer: 1 },
        ],
      },
      {
        title: 'The professional invitation',
        summary: 'Curiosity, permission and a specific time — inviting without pressure. Video: Eric Worre.',
        youtubeId: 'AVuRVTHwook',
        durationSec: 635,
        body: `An invitation is not a presentation. It is a short, respectful request for a conversation at a specific time. Your job is to create enough curiosity for the person to decide whether they want to look — not to explain the entire business in a message.

Use a simple three-step structure. First, connect: mention the context or something you genuinely appreciate. Second, create curiosity with one honest sentence about what you are doing or what the person could learn. Third, ask for a specific appointment: a 15-minute call, a short meeting or a link at an agreed time.

Do not dump links, audios and screenshots on someone who has not asked. Do not pretend the invitation is a favour, and do not promise income. If the person is not interested, thank them and keep the relationship. If they are unsure, agree a follow-up date instead of pushing for an immediate decision.

After every invitation, record the outcome in the CRM: invited, interested, follow-up required, not now or no. A contact without an outcome is not progress. The appointment is the win at this stage; the business decision comes later.`,
        takeaways: [
          'Invite to a conversation, not to join immediately.',
          'Use context, curiosity and a specific appointment time.',
          'Never dump links or pressure someone who has not asked.',
          'Every invitation needs a recorded outcome and next action.',
        ],
        transcript:
          'Video summary (not verbatim) — Eric Worre explains the fundamentals of inviting: keep it short, create curiosity, ask for a specific time and leave the decision with the prospect. The lesson adapts that to MarketSpase with a simple invitation structure and CRM follow-up discipline.',
        quiz: [
          { q: 'What is the purpose of an invitation?', options: ['To explain every product feature', 'To earn a respectful appointment', 'To force an immediate signup'], answer: 1 },
          { q: 'Which invitation is strongest?', options: ['A long business lecture by text', 'Context, curiosity and a specific time', 'A forwarded income screenshot'], answer: 1 },
          { q: 'What should you do when someone says no?', options: ['Thank them and preserve the relationship', 'Argue until they agree', 'Send the same message daily'], answer: 0 },
          { q: 'What makes an invitation count as progress?', options: ['Sending more links', 'Recording the outcome and next action', 'Getting a read receipt'], answer: 1 },
        ],
      },
      {
        title: 'Present, follow up and close',
        summary: 'A clean presentation, honest objection handling and follow-up that respects the prospect. Video: Frazer Brookes.',
        youtubeId: 'tn9geNkQof0',
        durationSec: 509,
        body: `A good presentation is a guided conversation. Start with the problem the product or opportunity solves, then show the product and the plan, give honest proof, and agree the next step. Keep it short enough for the prospect to ask questions.

Objections are usually requests for clarity. Time, money, trust and family approval are the common ones. Ask what is behind the objection before answering. Respond with facts, approved materials and relevant stories — never with pressure or invented income claims. If you do not know, say you will find out and come back.

Follow up when you said you would. Add value: answer the question you promised to answer, share the specific product information the person asked for, or confirm the agreed appointment. Do not use “just checking in” as a reason to message someone repeatedly.

The close is a clear invitation to decide: start now, book the next conversation, or leave it for now. All three are valid outcomes. Record the decision and the next date, and keep the relationship professional. A clean follow-up system protects your reputation and makes your business easier to duplicate.`,
        takeaways: [
          'Present the problem, product, plan, proof and next step.',
          'Ask what is behind an objection before answering it.',
          'Follow up with the value you promised, not with pressure.',
          'A clear decision or a dated next step is better than silence.',
        ],
        transcript:
          'Video summary (not verbatim) — Frazer Brookes explains practical follow-up: know why you are following up, bring value, keep the conversation human and agree a clear next step. The lesson applies that to presentations, objections and closing in MarketSpase conversations.',
        quiz: [
          { q: 'What should a presentation start with?', options: ['The problem the product or opportunity solves', 'Your rank and earnings', 'A list of every feature'], answer: 0 },
          { q: 'What should you do before answering an objection?', options: ['Repeat your pitch louder', 'Ask what is behind the objection', 'Ignore the question'], answer: 1 },
          { q: 'What makes follow-up professional?', options: ['Messaging every hour', 'Bringing the value you promised', 'Using pressure and deadlines'], answer: 1 },
          { q: 'Which outcome is acceptable?', options: ['Only an immediate signup', 'A decision, a dated next step or a respectful no', 'A promise to decide someday'], answer: 1 },
        ],
      },
      {
        title: 'Onboard and duplicate your first recruit',
        summary: 'A recruit without onboarding becomes a dropout — build the first 14 days and duplicate. Video: Richard Matharoo.',
        youtubeId: 'yRRSbl7tt4s',
        durationSec: 480,
        body: `Onboarding begins before the signup ends. A new partner needs to know what happens next, who to contact, what to complete first and what the first two weeks will look like. If you leave them to guess, they will disappear quietly.

In the first 48 hours, welcome them properly, confirm their login, help them open IPO, explain the 50-name list and book their first training session. Do not overwhelm them with every product and every document. Give them the next three actions only.

In the first 14 days, sit in on their first presentations, review their CRM, help them invite, and check in daily for a short period. The goal is not to do the business for them. The goal is to make the basic actions feel normal and safe.

Duplication happens when your recruit can copy what they see. Use the same invitation structure, the same CRM, the same training and the same weekly rhythm. Show your own calendar and numbers. Avoid secret methods that only you can operate. A simple system repeated by many people beats a brilliant system one person keeps to themselves.`,
        takeaways: [
          'Onboarding begins before signup ends.',
          'Give a new recruit three clear actions, not the whole library.',
          'Sit in on the first presentations and review the CRM together.',
          'Duplicate a simple, visible system — not secret methods.',
        ],
        transcript:
          'Video summary (not verbatim) — Richard Matharoo explains how duplication depends on a repeatable system that new partners can copy. The lesson turns it into a MarketSpase onboarding plan: welcome, first 48 hours, first 14 days, co-presenting and visible CRM/training habits.',
        quiz: [
          { q: 'When does onboarding begin?', options: ['Before the signup ends', 'After the first month', 'Only when the recruit asks'], answer: 0 },
          { q: 'How many actions should a new recruit receive at once?', options: ['Every action in the business', 'The next three clear actions', 'None until they earn'], answer: 1 },
          { q: 'What should you do during the first presentations?', options: ['Take over and do everything', 'Sit in, coach and make the basics visible', 'Leave them alone'], answer: 1 },
          { q: 'What makes duplication work?', options: ['Secret methods only you know', 'A simple system many people can copy', 'Waiting for perfect confidence'], answer: 1 },
        ],
      },
    ],
  },
  {
    title: 'Standard Method of Operation (SMO)',
    tagline: 'The weekly operating system that makes success repeatable.',
    description:
      'SMO turns activity into a predictable business. You will build a non-negotiable week, protect qualification and compliance, and lead the standard so your team can copy it. Complete all three lessons and pass each quiz. Your SMO rank training is recorded automatically.',
    milestone: 'smo',
    sortOrder: 2,
    coverUrl: 'https://i.ytimg.com/vi/6NJsfRltlKs/hqdefault.jpg',
    lessons: [
      {
        title: 'The non-negotiable week',
        summary: 'A weekly scorecard, calendar blocks and the activity that actually moves the business. Video: Frazer Brookes.',
        youtubeId: '6NJsfRltlKs',
        durationSec: 1602,
        body: `A standard week is a promise you make to your business. It contains the activities that create conversations, customers and team growth — not just the activities that feel busy.

Track a small weekly scorecard: new conversations, invitations, presentations, follow-ups completed, customer orders, team training attended and learning completed. These are leading indicators. If the numbers are low, the calendar tells you where to adjust before your upline has to guess.

Protect blocks in your calendar: a conversation block, a follow-up block, a learning block and your team training. Keep the blocks realistic. A consistent two-hour block beats an imaginary eight-hour day that never happens.

Use the CRM during the week, not at the end of it. Every conversation gets the next action and date. On review day, ask three questions: what created movement, what stalled, and what will I repeat next week? Then write the next week's commitments before the week starts.

The method is deliberately boring. Boring is easier to repeat, easier to teach and easier to measure. Your team should be able to look at your week and copy the structure without needing a private explanation.`,
        takeaways: [
          'Use a small weekly scorecard of leading indicators.',
          'Protect realistic calendar blocks for conversations, follow-up and learning.',
          'Update the CRM during the week, not after it.',
          'A repeatable weekly method beats an occasional heroic push.',
        ],
        transcript:
          'Video summary (not verbatim) — Frazer Brookes shares ten weekly actions that keep a network-marketing business moving. The lesson converts them into a MarketSpase weekly scorecard, calendar blocks, CRM discipline and a short weekly review.',
        quiz: [
          { q: 'What is a leading indicator?', options: ['A rank badge', 'Invitations and presentations completed', 'A future income promise'], answer: 1 },
          { q: 'When should the CRM be updated?', options: ['During the week', 'Once a quarter', 'Only after a sale'], answer: 0 },
          { q: 'Why keep the weekly method simple?', options: ['So it can be repeated and duplicated', 'So nobody can measure it', 'So it looks impressive'], answer: 0 },
          { q: 'What should a weekly review identify?', options: ['What moved, what stalled and what to repeat', 'Who to blame', 'The next rank only'], answer: 0 },
          { q: 'Which week is better?', options: ['A realistic block repeated consistently', 'One heroic day every month', 'A fully booked week that never happens'], answer: 0 },
        ],
      },
      {
        title: 'Qualification, maintenance and compliance',
        summary: 'Keep the account qualified, understand the ledger and communicate with honesty and accountability. Video: Jennah Dohms on honesty and transparency.',
        youtubeId: 'hkUSjaGiGzk',
        durationSec: 528,
        body: `A network-marketing business has rules, and those rules protect customers, partners and the company. Qualification and maintenance keep your account active and your team-side rewards intact. Check the requirements in the app and never let a month slip silently. One missed requirement can interrupt the compounding you have worked to build.

Understand your ledger. Pending money is not paid money. A released entry is payable; a refund or reversal can claw an entry back. Review the ledger weekly and keep the order references. If something looks wrong, ask support with the reference instead of guessing or posting accusations.

Compliance is not a separate department. It is how you communicate. Do not guarantee income, promise a rank, invent earnings, misrepresent the product or pressure someone with false urgency. Use the approved product information. Do not make medical claims unless the product has been approved for them. Disclose your material connection when you promote. Respect privacy and consent when you collect or share contact details.

When in doubt, stop and ask before you post. A missed sale is recoverable; a false claim can damage a customer, a partner and the business.`,
        takeaways: [
          'Keep account qualification and maintenance current.',
          'Pending is not paid; review the ledger and keep order references.',
          'Never guarantee income or misuse product claims.',
          'Ask before posting anything that sounds like a promise.',
        ],
        transcript:
          'Video summary (not verbatim) — Jennah Dohms shares how honesty, transparency and mutual accountability can transform personal and professional life. She describes a trusted peer group that asks difficult questions, gives honest feedback and supports genuine growth. The lesson applies those principles to ethical communication, relationship-building, account maintenance and the MarketSpase ledger.',
        quiz: [
          { q: 'What does a Pending ledger entry mean?', options: ['Money is already paid', 'The entry is not yet released', 'The order was cancelled'], answer: 1 },
          { q: 'What can a refund or reversal do?', options: ['Claw a commission back', 'Double the commission', 'Create a rank promotion'], answer: 0 },
          { q: 'Which statement is compliance-safe?', options: ['You will definitely earn this much', 'Results depend on your work and the plan', 'Everyone who joins gets rich'], answer: 1 },
          { q: 'What should you do with an unclear product claim?', options: ['Post it and delete it later', 'Check approved information or ask support', 'Make it sound stronger'], answer: 1 },
          { q: 'What protects long-term trust?', options: ['Pressure and false urgency', 'Honest communication and consent', 'Hiding the risks'], answer: 1 },
        ],
      },
      {
        title: 'Leading by the standard',
        summary: 'Run the weekly rhythm visibly so your team can copy it. Video: Richard Matharoo.',
        youtubeId: 'kK4i75aQx_I',
        durationSec: 310,
        body: `A leader does not ask the team to follow a standard the leader ignores. Run SMO in public: share your weekly scorecard, show your calendar blocks, and talk about the conversations you had and the follow-ups you completed.

Give the weekly team training a simple structure: recognise a behaviour worth repeating, teach one skill, review the numbers, answer questions and assign one action for the week. Start on time and finish on time. A short meeting that ends with assignments is better than a long meeting that ends with applause.

Coach by numbers and questions. Ask what happened, what the partner learned and what they will do next. Inspect the calendar kindly. Do not rescue every problem yourself; help the partner think. Recognition should reinforce the behaviours you want repeated, not only the biggest result.

Document the method so it survives your mood and your absence. The standard only becomes culture when leaders submit to it first and repeat it consistently.`,
        takeaways: [
          'Leaders run the standard visibly before asking others to follow it.',
          'Every team training ends with one clear assignment.',
          'Coach with numbers and questions, not blame.',
          'Document the method so it survives your absence.',
        ],
        transcript:
          'Video summary (not verbatim) — Richard Matharoo discusses leadership behaviours in network marketing. The lesson applies them to running a MarketSpase weekly team rhythm: visible scorecards, a short training agenda, coaching by numbers, recognition and documented duplication.',
        quiz: [
          { q: 'How should a leader introduce the standard?', options: ['By running it visibly first', 'By hiding their own numbers', 'By changing it weekly'], answer: 0 },
          { q: 'What should every team training end with?', options: ['A clear assignment', 'A longer meeting', 'A promise of income'], answer: 0 },
          { q: 'How should a leader coach?', options: ['With blame and pressure', 'With numbers, questions and next actions', 'By doing everything for the partner'], answer: 1 },
          { q: 'Why document the method?', options: ['So it survives the leader’s absence', 'So only the leader understands it', 'So it becomes harder to copy'], answer: 0 },
          { q: 'What should recognition reinforce?', options: ['Behaviours you want repeated', 'Only the biggest earner', 'Luck'], answer: 0 },
        ],
      },
    ],
  },
  {
    title: 'Leadership Development',
    tagline: 'Build leaders who can run the method without you in the room.',
    description:
      'Leadership is a pipeline, not a title. Learn to develop independent leaders, run a cell that duplicates, and hand over responsibility so the business scales beyond your personal hours. Complete all three lessons and pass each quiz. Your Leadership rank training is recorded automatically.',
    milestone: 'leadership',
    sortOrder: 3,
    coverUrl: 'https://i.ytimg.com/vi/Kl0rmx7aa0w/hqdefault.jpg',
    lessons: [
      {
        title: 'Raising leaders, not followers',
        summary: 'Build leaders through goals, calendars and coaching—not dependence. Video: Michael Bungay Stanier on taming the advice monster.',
        youtubeId: 'Kl0rmx7aa0w',
        durationSec: 870,
        body: `You do not promote people by wishing it. You develop them until promotion becomes obvious. Leadership is a pipeline: identify potential, give them a goal, help them build a calendar, coach the skill and give them responsibility.

Every emerging leader should have four things: a written goal, a calendar that reflects the goal, a weekly review with you and a skill they are currently practising. Without a calendar, the goal is a wish. Without a review, the calendar drifts. Without a skill plan, activity becomes random.

Do not solve every problem for them. Ask questions that build judgement: what did you observe, what did you try, what will you change next? Let them lead a small project before you hand over a room. Give responsibility with a clear boundary and a review date.

Measure yourself by leaders raised, not by how busy you are. A team that needs you for every decision has a leader who is doing too much. Build the bench deliberately.`,
        takeaways: [
          'Leadership is a pipeline, not a single promotion event.',
          'Give every emerging leader a goal, calendar, weekly review and skill.',
          'Build judgement with questions before handing over responsibility.',
          'Measure leaders raised, not personal busyness.',
        ],
        transcript:
          'Video summary (not verbatim) — Michael Bungay Stanier explains how the habit of giving advice can solve the wrong problem, disempower people and make the leader a bottleneck. He introduces the three advice-monster personas—Tell it, Save it and Control it—and three coaching questions: What’s the real challenge here for you? And what else? What do you want? The lesson applies those questions to the MarketSpase leadership pipeline: goals, calendars, weekly reviews and progressive responsibility.',
        quiz: [
          { q: 'What should every emerging leader have?', options: ['A goal, calendar, weekly review and skill plan', 'Only a title', 'A secret method'], answer: 0 },
          { q: 'Why is a calendar important?', options: ['It turns a goal into scheduled action', 'It replaces training', 'It guarantees income'], answer: 0 },
          { q: 'How should you develop judgement?', options: ['Ask questions and let them try', 'Solve every problem for them', 'Criticise them publicly'], answer: 0 },
          { q: 'When should responsibility increase?', options: ['After demonstrated readiness and a review', 'After one conversation', 'Only when the leader leaves'], answer: 0 },
          { q: 'How should a leader measure success?', options: ['Leaders raised and independent', 'Personal busyness', 'The number of meetings attended'], answer: 0 },
        ],
      },
      {
        title: 'Running a cell that duplicates',
        summary: 'A simple meeting rhythm, clear assignments and a culture that repeats. Video: Alexander Lyon.',
        youtubeId: 'iQsw3cdJbbM',
        durationSec: 684,
        body: `A cell needs rhythm. Use three repeating moments: weekly training, monthly recognition and quarterly planning. Keep each meeting under an hour, start on time and finish with assignments. A meeting without an assignment is entertainment.

The weekly agenda can be simple: wins, one skill, the numbers, questions and next actions. Rotate the person who presents the skill so leaders practise teaching. Share the scorecard so the team knows what activity matters. Recognise behaviours that can be repeated, not only outcomes.

Create ownership. Every leader should own a number, a project or a small part of the meeting. Ownership builds judgement and makes the cell less dependent on one personality. Follow up on assignments before the next meeting.

Culture is what repeats. If the leader arrives late, the team learns that lateness is acceptable. If the leader follows up, the team learns follow-up. Document the rhythm and model it visibly.`,
        takeaways: [
          'Use weekly training, monthly recognition and quarterly planning.',
          'Every meeting ends with a clear assignment.',
          'Rotate teaching and ownership so leaders develop judgement.',
          'Culture is what repeats — model the behaviour you want.',
        ],
        transcript:
          'Video summary (not verbatim) — Alexander Lyon explains five practical ways to run an effective meeting: preparation, purpose, participation, time control and follow-up. The lesson adapts those meeting skills to a MarketSpase cell with weekly training, recognition, assignments and rotating ownership.',
        quiz: [
          { q: 'What is the recommended cell rhythm?', options: ['Weekly training, monthly recognition, quarterly planning', 'One annual meeting', 'Daily two-hour calls'], answer: 0 },
          { q: 'How should every meeting end?', options: ['With a clear assignment', 'With a motivational speech only', 'With no next step'], answer: 0 },
          { q: 'Why rotate teaching?', options: ['To develop leaders’ judgement and skill', 'To make the leader less visible', 'To fill time'], answer: 0 },
          { q: 'What should recognition reinforce?', options: ['Repeatable behaviours', 'Only luck', 'Secret methods'], answer: 0 },
          { q: 'What does a cell culture reflect?', options: ['What the leader repeats and models', 'The office decoration', 'The loudest member'], answer: 0 },
        ],
      },
      {
        title: 'Succession and scale',
        summary: 'Document the method, hand over the room and measure the leaders you raise. Video: Business School 101.',
        youtubeId: 'QG_oEdi6dLE',
        durationSec: 484,
        body: `Succession is planned, not an event. Start early: identify the people who could run the weekly rhythm, the training rotation or a small team. Give them responsibility one piece at a time and review the result.

Document the method. Write down the scripts, checklists, meeting agendas, reporting rhythm and decision rules. If the knowledge exists only in your head, the business cannot scale beyond your energy. Documentation is not bureaucracy; it is how you multiply judgement.

Hand over the room gradually. Watch a leader run the meeting, give feedback, then let them run it again. Stay available as a coach, not as a permanent rescuer. Measure leaders raised, retention, team activity and the health of the pipeline — not only volume.

A leader's legacy is the leaders left behind. Build a bench that can operate without you in the room, and you have created a business rather than a personal performance.`,
        takeaways: [
          'Plan succession early and give responsibility in stages.',
          'Document scripts, agendas, reporting and decision rules.',
          'Hand over gradually; coach without permanently rescuing.',
          'Measure leaders raised, retention and team health.',
        ],
        transcript:
          'Video summary (not verbatim) — Business School 101 explains succession planning: identifying critical roles, preparing people and transferring responsibility deliberately. The lesson applies it to MarketSpase leadership by documenting the method, rotating ownership and measuring the leaders raised.',
        quiz: [
          { q: 'When should succession planning begin?', options: ['Early, before a crisis', 'Only when the leader leaves', 'After a year of inactivity'], answer: 0 },
          { q: 'Why document the method?', options: ['So the business can scale beyond one person', 'So nobody else can use it', 'To avoid training'], answer: 0 },
          { q: 'How should responsibility be handed over?', options: ['One piece at a time with review', 'All at once with no support', 'Never'], answer: 0 },
          { q: 'What should a leader measure?', options: ['Leaders raised, retention and team health', 'Only personal volume', 'Hours spent in meetings'], answer: 0 },
          { q: 'What is a leadership legacy?', options: ['The leaders left behind who can run without you', 'A bigger personal title', 'A secret script'], answer: 0 },
        ],
      },
    ],
  },
];

const uri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;
await mongoose.connect(uri);
const db = mongoose.connection.name;

let adminId = null;
try {
  const snapshot = JSON.parse(await fs.readFile(path.join(process.cwd(), 'seed', 'ipo-course.snapshot.json'), 'utf8'));
  adminId = snapshot?.sourceAdmin?.id ?? null;
} catch { /* fall back to a live admin lookup */ }
if (!adminId) {
  const admin = await mongoose.connection.db.collection('partners').findOne({ role: 'admin' });
  adminId = admin?._id ?? null;
}
const adminOid = adminId ? new mongoose.Types.ObjectId(String(adminId)) : null;
const auditActor = adminId ? String(adminId) : 'system:academy-seed';
const audit = new MongoAuditStore();
const now = new Date();

let createdCourses = 0;
let updatedCourses = 0;
let createdLessons = 0;
let updatedLessons = 0;

for (const seed of COURSES) {
  const coursePayload = {
    title: seed.title,
    tagline: seed.tagline,
    description: seed.description,
    milestone: seed.milestone,
    coverUrl: seed.coverUrl,
    status: 'published',
    sortOrder: seed.sortOrder,
    updatedBy: adminOid,
  };
  let course = await TrainingCourseModel.findOne({
    $or: [{ title: seed.title }, { milestone: seed.milestone }],
  }).sort({ sortOrder: 1 });
  const existed = Boolean(course);
  if (!course) {
    course = await TrainingCourseModel.create({
      ...coursePayload,
      publishedAt: now,
      createdBy: adminOid,
    });
    createdCourses += 1;
  } else {
    course = await TrainingCourseModel.findByIdAndUpdate(
      course._id,
      {
        $set: {
          ...coursePayload,
          publishedAt: course.publishedAt ?? now,
          createdBy: course.createdBy ?? adminOid,
        },
      },
      { new: true },
    );
    updatedCourses += 1;
  }

  await audit.record({
    actorId: auditActor,
    action: existed ? 'training.course.update' : 'training.course.create',
    targetType: 'course',
    targetId: String(course._id),
    detail: { title: seed.title, milestone: seed.milestone, status: 'published', source: 'seed:remaining' },
  });

  for (const [index, lesson] of seed.lessons.entries()) {
    const media = youtube(lesson.youtubeId);
    const lessonPayload = {
      courseId: course._id,
      title: lesson.title,
      summary: lesson.summary,
      body: lesson.body,
      takeaways: lesson.takeaways,
      transcript: lesson.transcript,
      youtubeId: media.youtubeId,
      youtubeUrl: media.youtubeUrl,
      thumbnailUrl: media.thumbnailUrl,
      durationSec: lesson.durationSec,
      quiz: lesson.quiz,
      status: 'published',
      sortOrder: index,
      updatedBy: adminOid,
    };
    const existing = await TrainingLessonModel.findOne({ courseId: course._id, title: lesson.title });
    const saved = existing
      ? await TrainingLessonModel.findByIdAndUpdate(
        existing._id,
        { $set: { ...lessonPayload, createdBy: existing.createdBy ?? adminOid } },
        { new: true },
      )
      : await TrainingLessonModel.create({ ...lessonPayload, createdBy: adminOid });
    if (existing) updatedLessons += 1;
    else createdLessons += 1;
    await audit.record({
      actorId: auditActor,
      action: existing ? 'training.lesson.update' : 'training.lesson.create',
      targetType: 'lesson',
      targetId: String(saved._id),
      detail: { courseId: String(course._id), title: lesson.title, youtubeId: lesson.youtubeId, status: 'published', source: 'seed:remaining' },
    });
  }
}

const courses = await TrainingCourseModel.find({ milestone: { $in: ['qsg', 'smo', 'leadership'] } })
  .sort({ sortOrder: 1 })
  .lean();
const lessons = await TrainingLessonModel.find({ courseId: { $in: courses.map((course) => course._id) } })
  .sort({ courseId: 1, sortOrder: 1 })
  .lean();

console.log(JSON.stringify({
  database: db,
  admin: adminId ? String(adminId) : 'system:academy-seed',
  counts: { createdCourses, updatedCourses, createdLessons, updatedLessons },
  courses: courses.map((course) => ({
    id: String(course._id),
    title: course.title,
    milestone: course.milestone,
    status: course.status,
    sortOrder: course.sortOrder,
    lessons: lessons.filter((lesson) => String(lesson.courseId) === String(course._id)).length,
  })),
  totalLessons: lessons.length,
  totalQuizQuestions: lessons.reduce((total, lesson) => total + (lesson.quiz?.length ?? 0), 0),
}, null, 2));

await mongoose.connection.close(false);
