import 'dotenv/config';
import mongoose from 'mongoose';
import { TrainingCourseModel, TrainingLessonModel } from '../src/modules/training/infrastructure/Training.models.js';
import { MongoAuditStore } from '../src/modules/audit/infrastructure/Audit.store.js';

/**
 * Seed the Recruiting Mastery 2026 elective.
 *
 * Idempotent by course title and lesson title: re-running updates the same
 * course/lessons instead of creating duplicates. The course has no rank
 * milestone, so completing it never changes a partner's rank.
 */

const COURSE = {
  title: 'Recruiting Mastery 2026',
  tagline: 'A repeatable system for attracting, inviting and enrolling quality partners.',
  description:
    'Recruiting is a skill, not a personality trait. This elective builds a repeatable system: attract the right audience with content, adopt the habits of top recruiters, run a six-step process, keep daily activity high, and use three-way calls to borrow credibility. It is an elective and does not change your rank. Complete the lessons and quizzes at your own pace, then use the notes with your upline and in your weekly plan.',
  milestone: null,
  status: 'published',
  sortOrder: 7,
  coverUrl: 'https://i.ytimg.com/vi/XoN4QYode8U/hqdefault.jpg',
};

const youtube = (id) => ({
  youtubeId: id,
  youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
});

const LESSONS = [
  {
    title: 'Attract the right audience with content',
    summary: 'Build a simple content habit that turns attention into recruiting conversations — without spam or income claims.',
    youtubeId: 'tHK7s9gJ1Ho',
    durationSec: 1525,
    body: `Recruiting starts before the invitation. Content is how strangers meet your thinking, your standards and your business before you ever ask for a conversation. You do not need to go viral. You need the right people to recognise that you are worth listening to.

Choose one audience and one repeatable message. Decide who you help, what problem you solve and what change you are inviting people into. Then say it again and again in different formats. A clear message repeated beats a clever message that changes every week.

Use content to create conversations, not applause. Educational posts, customer stories, behind-the-scenes work, honest lessons and simple invitations all have a place. The first few seconds matter: lead with a specific outcome, a useful question or a story that earns attention. Then give people a clear next step — comment, message you or join a conversation — and move interested people into your CRM the same day.

Keep a realistic rhythm. Three to five useful posts a week, one live or story sequence, and a short weekly review are enough to build momentum. Track conversations and qualified enquiries, not just likes. Most importantly, stay compliant: no guaranteed income, no invented results, no product claims outside approved information, and no unsolicited bulk messaging. Content should make you easier to trust, not harder to believe.`,
    takeaways: [
      'Choose one audience and one message you can repeat consistently.',
      'Content exists to start conversations with the right people, not to collect likes.',
      'Use hooks, stories and proof — never income promises or pressure.',
      'Review which posts created real conversations, not just views.',
    ],
    transcript:
      'Video summary (not verbatim) — Frazer Brookes explains how to use social media content to build reach and attention. This lesson applies the principles to MarketSpase recruiting: one clear audience and message, a consistent posting rhythm, honest proof, and a deliberate path from content to conversation and CRM follow-up.',
    quiz: [
      {
        q: 'What is the main purpose of recruiting content?',
        options: ['To collect as many likes as possible', 'To start conversations with the right people', 'To replace all one-to-one follow-up'],
        answer: 1,
      },
      {
        q: 'What should you decide before posting consistently?',
        options: ['One audience and one repeatable message', 'A new topic every day', 'The exact income a recruit will earn'],
        answer: 0,
      },
      {
        q: 'Which result matters most?',
        options: ['Views only', 'Conversations and qualified enquiries', 'The number of hashtags used'],
        answer: 1,
      },
      {
        q: 'Which content is unsafe?',
        options: ['A customer story with permission', 'A guaranteed income claim', 'A practical how-to post'],
        answer: 1,
      },
    ],
  },
  {
    title: 'Recruiting Machine: the 19-minute overview',
    summary: 'Why recruiting creates leverage and the six-step process that makes it repeatable.',
    youtubeId: 'm1jU_e8ogok',
    durationSec: 1150,
    body: `Recruiting is how a network-marketing business creates leverage. Your own hours are fixed; a team of people who can serve customers and invite others multiplies what one person can do. That is why recruiting is a skill worth learning, not a favour you ask of friends.

This overview gives you the big picture before the detailed lessons. The process has six steps. Generate leads through content, referrals and real conversations. Ask a short, honest question that gives the person permission to say no. Qualify before you present so you spend your time with people who are serious. Present the product, plan, people and process simply. Follow up with a reason and a clear next step. Then launch the new partner properly and lead the people who want to build.

The order matters, but consistency matters more. A simple process repeated every week beats an occasional burst of activity. Keep your pipeline visible, track the activity you control and keep your claims honest. Recruiting is not about pushing people into a decision; it is about giving the right people enough clarity to make one.`,
    takeaways: [
      'Recruiting creates leverage because a team can serve more people than you can alone.',
      'Use the six-step process: lead, ask, qualify, present, follow up, launch and lead.',
      'Consistency with a simple process beats occasional bursts of activity.',
      'Give people clarity and permission to decide — never pressure or hype.',
    ],
    transcript:
      'Video summary (not verbatim) — Frazer Brookes explains why recruiting creates leverage and walks through a practical six-step recruiting process for network marketing. This lesson gives the big-picture overview before the course goes deeper into content, mindset, daily activity and three-way calls.',
    quiz: [
      {
        q: 'Why does recruiting create leverage?',
        options: ['It guarantees income', 'A team can serve more people than one person alone', 'It removes the need for products'],
        answer: 1,
      },
      {
        q: 'What comes immediately after generating a lead?',
        options: ['Ask the question or invite', 'Launch them as a partner', 'Ask for a testimonial'],
        answer: 0,
      },
      {
        q: 'Why qualify before presenting?',
        options: ['To separate serious prospects from curious ones', 'To make the presentation longer', 'To avoid asking questions'],
        answer: 0,
      },
      {
        q: 'What completes the recruiting process?',
        options: ['Launching and leading the new partner', 'Sending one link', 'Waiting for the prospect to chase you'],
        answer: 0,
      },
    ],
  },
  {
    title: 'The 2026 recruiter mindset',
    summary: 'What top recruiters do differently: standards, activity and a process they can teach.',
    youtubeId: 'XoN4QYode8U',
    durationSec: 1786,
    body: `Top recruiters are not born with a secret personality. They run a simple process consistently and treat people with respect. The first shift is moving your attention from results you cannot control to activity you can control: conversations started, invitations made, presentations booked and follow-ups completed.

The second shift is understanding the difference between convincing and advising. Amateurs try to convince. Professionals qualify first, then advise people through a clear process. Ask why someone is open, what they want to change and how serious they are before you present. The harder you qualify, the easier the decision becomes.

Build a pipeline you can see: generate a lead, ask the question, qualify, present, follow up, launch and then lead. When the pipeline is clear, you stop guessing what to do next and you can teach the same steps to a new partner. Track your own numbers so you know how much activity produces a conversation, a presentation and a recruit. Then set daily activity targets instead of waiting for motivation.

Keep your posture professional. Do not chase, pressure or overpromise. Give people permission to say no. Protect your reputation with honest claims and approved materials. Consistency, not intensity, is what makes recruiting repeatable — and what makes it safe for your team to copy.`,
    takeaways: [
      'Focus on activity you control, not results you cannot control.',
      'Professionals qualify and advise; amateurs try to convince.',
      'Use a visible pipeline and know your own conversion numbers.',
      'Consistency, honesty and posture beat pressure and hype.',
    ],
    transcript:
      'Video summary (not verbatim) — Frazer Brookes explains the habits and standards that separate top recruiters from people who rely on occasional bursts of effort. The lesson connects those habits to a MarketSpase recruiting pipeline: qualify first, advise through a process, measure activity and protect trust.',
    quiz: [
      {
        q: 'What should a recruiter focus on first?',
        options: ['Results they cannot control', 'Activity they can control', 'Waiting to feel motivated'],
        answer: 1,
      },
      {
        q: 'What separates a professional from an amateur?',
        options: ['Professionals qualify and advise', 'Professionals pressure harder', 'Professionals avoid follow-up'],
        answer: 0,
      },
      {
        q: 'Why track your recruiting numbers?',
        options: ['To compare yourself to strangers', 'To know what activity produces results', 'To guarantee income'],
        answer: 1,
      },
      {
        q: 'Which behaviour protects your reputation?',
        options: ['Honest claims and permission to say no', 'False urgency and guaranteed income', 'Ignoring consent'],
        answer: 0,
      },
    ],
  },
  {
    title: 'Your 6-step recruiting process',
    summary: 'A complete pipeline from lead generation to leadership duplication.',
    youtubeId: 'nPwRCjUYYI8',
    durationSec: 813,
    body: `A recruiting conversation is easier when you know where you are in the process. Use six steps: generate a lead, ask the question, qualify, present, follow up and launch — then lead the people who join.

Generate leads through content, referrals, warm relationships and the people already engaging with you. Ask a short, human question that gives the person permission to say no. A useful frame is: “Would you be open to looking at some information on a system I use to help people build extra income?” Keep it curious, not pushy.

Qualify before you present. Ask why they want to make a change, why it matters now and whether they are willing to look at the information properly. Curious people are not the same as serious prospects. Present the product, the plan, the people and the process so the prospect can answer three questions: What do I do? Can I do it? Will it be worth it?

Follow up with a reason and a next step. Set a time to review the information, answer questions and introduce your upline or a three-way call where useful. Then launch the new partner properly: welcome them, complete the first actions, set a 30-day plan and help them make their first conversations. The final step is leadership — identify the people who want to build, work closely with them and teach them the same six steps.`,
    takeaways: [
      'Use one pipeline: lead, ask, qualify, present, follow up and launch.',
      'Qualify before presenting; curiosity is not the same as commitment.',
      'Answer what to do, whether they can do it and why it is worth it.',
      'Duplication happens when new partners can repeat the same process.',
    ],
    transcript:
      'Video summary (not verbatim) — Frazer Brookes lays out a six-step recruiting process: generate leads, ask the question, qualify, present, follow up and launch into leadership. The lesson adapts the process to MarketSpase with consent-aware invitations, simple qualification and a 30-day launch rhythm.',
    quiz: [
      {
        q: 'What is the correct first step?',
        options: ['Present immediately', 'Generate a lead', 'Ask for payment'],
        answer: 1,
      },
      {
        q: 'Why qualify before presenting?',
        options: ['To separate serious prospects from curious ones', 'To make the conversation longer', 'To avoid asking questions'],
        answer: 0,
      },
      {
        q: 'Which three questions should a presentation answer?',
        options: ['What do I do, can I do it, is it worth it?', 'Who is the president, where is the office, what is the logo?', 'How fast can I get rich?'],
        answer: 0,
      },
      {
        q: 'What completes the process?',
        options: ['Launching and leading the new partner', 'Sending one link and stopping', 'Waiting for the prospect to chase you'],
        answer: 0,
      },
    ],
  },
  {
    title: 'Find, add, message: the daily recruiting engine',
    summary: 'Turn recruiting into a daily habit: find the right people, connect with context and start conversations.',
    youtubeId: '1eWkeNDmQj4',
    durationSec: 930,
    body: `Results follow activity multiplied by skill. The daily engine is simple: find the right people, connect with context and start a real conversation. The quality of the list matters more than raw volume. Use content engagement, relevant groups, referrals and your existing network to find people who already show interest in the life you are building.

Connect with a reason. A blank request or a copy-pasted pitch is easy to ignore. Reference the post they engaged with, the group you share or the problem they talked about. Then send a short, human message. Ask a question instead of delivering a speech. The L.O.R.D. frame — location, occupation, recreation, dreams — gives you a natural way to build rapport before you invite.

Expect most people not to reply, and that is normal. Follow up once or twice with value, then move on. Log every conversation in the CRM with the next action and date. Track new conversations, replies, invitations and presentations rather than only signups. A realistic daily target — for example, ten new conversations and three follow-ups — is more useful than an imaginary hundred-message blitz.

Never spam, never scrape private data and never ignore consent. Personalisation is not a trick; it is evidence that you see a person, not a target. The recruiters who last are the ones who can repeat a calm daily habit without damaging their reputation.`,
    takeaways: [
      'Find people with context and genuine relevance, not random volume.',
      'Open with a short human question, not a copy-pasted pitch.',
      'Log every conversation and next action in the CRM.',
      'A calm daily habit beats an occasional spam blitz.',
    ],
    transcript:
      'Video summary (not verbatim) — Frazer Brookes shares a daily find-add-message activity system and the numbers behind consistent recruiting. The lesson applies it to MarketSpase with consent-aware outreach, personal context, CRM follow-up and realistic daily targets.',
    quiz: [
      {
        q: 'What makes a prospect worth adding?',
        options: ['Random volume', 'Relevant context or genuine interest', 'A copied list of strangers'],
        answer: 1,
      },
      {
        q: 'How should an opening message begin?',
        options: ['With a short human question', 'With a full business presentation', 'With an income guarantee'],
        answer: 0,
      },
      {
        q: 'What should you record after a conversation?',
        options: ['Nothing', 'The next action and date in the CRM', 'Only the person’s income'],
        answer: 1,
      },
      {
        q: 'Which behaviour is unacceptable?',
        options: ['Personalising with context', 'Respecting consent', 'Spamming or scraping private data'],
        answer: 2,
      },
    ],
  },
  {
    title: 'Recruit 20 people in 10 days',
    summary: 'A focused 10-day sprint: the activity, conversations and follow-up that create momentum.',
    youtubeId: '65aFeHZmG7M',
    durationSec: 462,
    body: `A 10-day recruiting sprint is a concentrated push, not a permanent pace. Its purpose is to create momentum, prove the process to yourself and build habits you can keep. Decide the goal, block the time and prepare before day one: your list, your content, your invitation, your presentation link and a simple tracker.

Each day should include three activities: new conversations, follow-ups and at least one presentation or three-way call. Do not spend the whole day preparing. Start conversations early, qualify quickly and book the next step before you move on. A sprint exposes where the process breaks: too few leads, weak invitations, poor qualification or slow follow-up.

Use team support deliberately. Ask your upline for a three-way call when a prospect has questions you cannot answer, and debrief after each call. Keep messages honest and consent-based. A sprint is not a licence to spam, pressure or promise income. The goal is qualified conversations, not a body count.

Review the numbers every evening. What created replies? Which invitation booked presentations? Where did follow-up stall? Adjust the next day, not next month. At the end of the 10 days, keep the useful parts as a weekly rhythm and return to a sustainable pace. Momentum is valuable only when it can be repeated.`,
    takeaways: [
      'A sprint is a short, focused push — not a permanent pace.',
      'Prepare the list, invitation, presentation and tracker before day one.',
      'Every day needs new conversations, follow-ups and presentations.',
      'Keep the habits that worked and return to a sustainable rhythm.',
    ],
    transcript:
      'Video summary (not verbatim) — Michelle Cunningham shares a focused recruiting sprint approach for generating a large number of conversations in a short period. The lesson adapts it to MarketSpase with daily activity targets, consent-aware follow-up, team support and an honest end-of-sprint review.',
    quiz: [
      {
        q: 'What is a recruiting sprint?',
        options: ['A permanent daily pace', 'A short, focused push to create momentum', 'A reason to spam'],
        answer: 1,
      },
      {
        q: 'What should you prepare before day one?',
        options: ['List, invitation, presentation and tracker', 'Only a logo', 'Nothing at all'],
        answer: 0,
      },
      {
        q: 'What should every sprint day include?',
        options: ['New conversations, follow-ups and presentations', 'Only content posting', 'Only waiting for inbound leads'],
        answer: 0,
      },
      {
        q: 'What should happen after the sprint?',
        options: ['Keep the useful habits at a sustainable pace', 'Stop all activity', 'Double the pressure forever'],
        answer: 0,
      },
    ],
  },
  {
    title: 'Recruit on demand: the professional standard',
    summary: 'The professional recruiting standard: preparation, invitation, presentation, follow-up and posture.',
    youtubeId: 'dAY_W-bAjck',
    durationSec: 1637,
    body: `Recruiting on demand does not mean reciting a script. It means having a repeatable professional process you trust enough to use in any conversation. Preparation creates calm: know the product, the plan, your own story, your list and your calendar. When you are prepared, you can listen instead of performing.

Invite with posture. Keep the invitation short, create curiosity and ask for a specific time. Do not dump links or explain the whole business in a message. The invitation is a request for a conversation, not a request for a decision. Present with approved tools and let the tool do the explaining. Your job is to answer questions, connect the information to the person’s goals and keep the next step clear.

Follow up with purpose. Ask what the person understood, what questions remain and whether the information is a fit. Handle objections by asking what is behind them, then respond with facts and approved materials. Never pressure, invent income or use false urgency. If the answer is no, thank the person and preserve the relationship.

When someone joins, launch them properly. Confirm the first actions, set a 30-day plan and help them make their first conversations. Recruiting on demand is a professional standard, not a one-off sale. The goal is a partner who knows what to do next and a process your team can repeat without you in the room.`,
    takeaways: [
      'Preparation creates calm: know the product, plan, story and calendar.',
      'Invite to a specific conversation, not to an immediate decision.',
      'Follow up with questions and approved information, never pressure.',
      'Launch new partners properly so the process can duplicate.',
    ],
    transcript:
      'Video summary (not verbatim) — Eric Worre explains the professional recruiting standard: preparation, a clear invitation, a simple presentation, purposeful follow-up and proper launch. The lesson applies those standards to MarketSpase with approved tools, honest claims and a repeatable partner onboarding rhythm.',
    quiz: [
      {
        q: 'What does recruiting on demand require?',
        options: ['A repeatable professional process', 'A magical script', 'Pressuring every prospect'],
        answer: 0,
      },
      {
        q: 'What is an invitation for?',
        options: ['A specific conversation', 'An immediate signup', 'A full business lecture by text'],
        answer: 0,
      },
      {
        q: 'How should you handle an objection?',
        options: ['Ask what is behind it, then answer with facts', 'Repeat the pitch louder', 'Invent an income promise'],
        answer: 0,
      },
      {
        q: 'What should happen after someone joins?',
        options: ['A proper launch and 30-day plan', 'Silence', 'A demand to recruit immediately'],
        answer: 0,
      },
    ],
  },
  {
    title: 'Three-way calls: borrow credibility',
    summary: 'Use a third voice to answer questions, build belief and help a prospect decide.',
    youtubeId: 'YEy3rzp8cew',
    durationSec: 530,
    body: `A three-way call brings a trusted third voice into a recruiting conversation. It is not a hand-off and it is not an ambush. It is a deliberate way to borrow credibility when a prospect has questions, needs to hear another story or is close to a decision. The person who invited the prospect stays in the relationship; the expert adds experience.

Use a three-way call after an invitation or presentation, when an objection needs a deeper answer, before a decision, or when welcoming a new partner. Ask permission first, agree a time and brief the expert on the prospect’s situation. Then edify the expert honestly: explain why this person is worth listening to and what they have done. Hand over the conversation, let the prospect ask questions and take notes.

Do not let the expert take over the relationship or pressure the prospect. The goal is clarity, not a performance. At the end, summarise the next step, confirm the date and follow up yourself. Log the outcome in the CRM. Use the same discipline when onboarding a new partner: a welcome call with their upline can answer early questions and make the first week feel safe.

Three-way calls work because people trust people. Protect that trust with honesty, preparation and a clear next step.`,
    takeaways: [
      'A three-way call adds a trusted voice; it does not replace the relationship.',
      'Ask permission, set a time and brief the expert before the call.',
      'Edify honestly and let the prospect ask questions.',
      'Confirm the next step yourself and log the outcome.',
    ],
    transcript:
      'Video summary (not verbatim) — Brian Carruthers explains how three-way calls transfer credibility and help prospects make decisions. The lesson applies the method to MarketSpase recruiting and onboarding: permission, preparation, honest edification, a clear next step and CRM follow-up.',
    quiz: [
      {
        q: 'What is the purpose of a three-way call?',
        options: ['To borrow credibility and answer questions', 'To pressure the prospect', 'To replace all follow-up'],
        answer: 0,
      },
      {
        q: 'What should you do before the call?',
        options: ['Ask permission, set a time and brief the expert', 'Surprise the prospect', 'Send no context'],
        answer: 0,
      },
      {
        q: 'Who keeps the relationship with the prospect?',
        options: ['The person who invited them', 'The expert alone', 'Nobody'],
        answer: 0,
      },
      {
        q: 'What should you confirm at the end?',
        options: ['The next step and date', 'A guaranteed income', 'A public argument'],
        answer: 0,
      },
    ],
  },
];

const uri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

await mongoose.connect(uri);
const db = mongoose.connection.name;
const admin = await mongoose.connection.db.collection('partners').findOne({ role: 'admin' });
if (!admin) {
  throw new Error('No admin account found - create the admin user before seeding the Academy');
}

const now = new Date();
const audit = new MongoAuditStore();
const adminOid = admin._id;

let course = await TrainingCourseModel.findOne({ title: COURSE.title }).sort({ sortOrder: 1 });
const courseExisted = Boolean(course);
if (!course) {
  course = await TrainingCourseModel.create({
    ...COURSE,
    publishedAt: now,
    createdBy: adminOid,
    updatedBy: adminOid,
  });
} else {
  course = await TrainingCourseModel.findByIdAndUpdate(
    course._id,
    {
      $set: {
        ...COURSE,
        publishedAt: course.publishedAt ?? now,
        createdBy: course.createdBy ?? adminOid,
        updatedBy: adminOid,
      },
    },
    { new: true },
  );
}

await audit.record({
  actorId: String(adminOid),
  action: courseExisted ? 'training.course.update' : 'training.course.create',
  targetType: 'course',
  targetId: String(course._id),
  detail: { title: COURSE.title, milestone: null, status: 'published', source: 'seed:recruiting' },
});

let createdLessons = 0;
let updatedLessons = 0;
for (const [index, lesson] of LESSONS.entries()) {
  const media = youtube(lesson.youtubeId);
  const payload = {
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
      { $set: { ...payload, createdBy: existing.createdBy ?? adminOid } },
      { new: true },
    )
    : await TrainingLessonModel.create({ ...payload, createdBy: adminOid });
  if (existing) updatedLessons += 1;
  else createdLessons += 1;
  await audit.record({
    actorId: String(adminOid),
    action: existing ? 'training.lesson.update' : 'training.lesson.create',
    targetType: 'lesson',
    targetId: String(saved._id),
    detail: {
      courseId: String(course._id),
      title: lesson.title,
      youtubeId: lesson.youtubeId,
      status: 'published',
      source: 'seed:recruiting',
    },
  });
}

const lessons = await TrainingLessonModel.find({ courseId: course._id })
  .sort({ sortOrder: 1 })
  .lean();

console.log(JSON.stringify({
  database: db,
  admin: String(adminOid),
  course: {
    id: String(course._id),
    title: course.title,
    milestone: course.milestone,
    status: course.status,
    sortOrder: course.sortOrder,
  },
  counts: { createdLessons, updatedLessons },
  lessons: lessons.map((lesson) => ({
    id: String(lesson._id),
    title: lesson.title,
    youtubeId: lesson.youtubeId,
    durationSec: lesson.durationSec,
    status: lesson.status,
    sortOrder: lesson.sortOrder,
  })),
  totalLessons: lessons.length,
  totalQuizQuestions: lessons.reduce((total, lesson) => total + (lesson.quiz?.length ?? 0), 0),
}, null, 2));

await mongoose.connection.close(false);
