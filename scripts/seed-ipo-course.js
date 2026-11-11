import 'dotenv/config';
import mongoose from 'mongoose';
import { TrainingCourseModel, TrainingLessonModel } from '../src/modules/training/infrastructure/Training.models.js';
import { MongoAuditStore } from '../src/modules/audit/infrastructure/Audit.store.js';

/**
 * Seed the first Academy course: Initial Planning Orientation (IPO).
 *
 * Idempotent: re-running updates the same IPO course and the four lessons by
 * title instead of creating duplicates. All videos are public YouTube links;
 * MarketSpase stores only the URL, id, thumbnail and duration.
 */

const COURSE = {
  title: 'Initial Planning Orientation (IPO)',
  tagline: 'Understand the business, the money flow and your first 30 days.',
  description:
    'IPO is the first step in the MarketSpase Academy. Learn how a network-marketing business earns, how commissions move from a customer order to the field, what professional follow-up looks like, and the simple rhythm that makes the first 30 days count. Finish all four lessons and pass each quiz. Your IPO rank training is recorded automatically.',
  milestone: 'ipo',
  status: 'published',
  coverUrl: 'https://i.ytimg.com/vi/RzOgum0ybNM/hqdefault.jpg',
};

const youtube = (id) => ({
  youtubeId: id,
  youtubeUrl: `https://www.youtube.com/watch?v=${id}`,
  thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
});

const LESSONS = [
  {
    title: 'The business model: how you earn',
    summary: 'Why products come first, how the network works, and what separates a real business from hype. Video: Frazer Brookes.',
    youtubeId: 'RzOgum0ybNM',
    durationSec: 1217,
    body: `Network marketing is a direct-selling business. You earn when products are sold to real customers, and you can also build a team that sells products. There is no salary and no shortcut. Income follows the value you create for customers and the consistency with which you build your team.

Your business has two engines.

Retail: find people who need the products, serve them well, and earn from repeat orders. Team: invite serious people, train them to do the same, and earn from team product sales according to the compensation plan.

The product is the reason a customer returns. The team is the reason the business can grow beyond your personal hours. Neither works without trust.

Before you invite anyone, be able to explain three things in five minutes: what problem the product solves, how a partner earns, and what the first 30 days look like. If you cannot explain it simply, you are not ready to recruit. Learn it, practise it, then invite.`,
    takeaways: [
      'Income follows product sales and team sales, not tenure or hype.',
      'Retail customers create the repeat revenue that makes the business durable.',
      'Learn the product and plan well enough to explain them in five minutes.',
    ],
    transcript:
      'Video summary (not verbatim) — Frazer Brookes explains the network-marketing model: products are sold to real customers, partners can build teams, and income follows the value created. The lesson connects that model to MarketSpase: products and trust come before growth, and every partner should be able to explain the product, earning model and first 30 days simply.',
    quiz: [
      {
        q: 'How does a partner earn in MarketSpase?',
        options: [
          'A fixed salary from the company',
          'Through product sales and team product sales',
          'Only by recruiting new people',
        ],
        answer: 1,
      },
      {
        q: 'What makes the business durable?',
        options: ['Repeat product customers', 'Big launches only', 'Changing the plan often'],
        answer: 0,
      },
      {
        q: 'Before inviting a prospect, you should…',
        options: [
          'Be able to explain the product, earning model and first 30 days simply',
          'Wait until you have a title',
          'Promise a guaranteed income',
        ],
        answer: 0,
      },
      {
        q: 'Which statement is true?',
        options: [
          'Recruitment alone is the business',
          'Products and trust come before growth',
          'Income is guaranteed once you join',
        ],
        answer: 1,
      },
    ],
  },
  {
    title: 'How commissions flow',
    summary: 'Pending, released, voided and your ledger — the money lifecycle in plain language. Video: Wealthanize.',
    youtubeId: '3ASdyUGcjBg',
    durationSec: 1300,
    body: `Every product order can create commissions along the referral chain. The company earns from the sale, the partner who served the customer earns, and the mentors above earn according to the compensation plan. The plan is designed so that every contribution has a defined reward.

A commission entry starts as Pending when an order is created. It becomes Released when the order is approved and payable. If the order is refunded, cancelled or reversed, the commission is voided or clawed back. That is why the ledger is the single source of truth: it records what happened, not what someone promised.

Check your ledger weekly. Know the difference between pending and released money. Keep your account qualified, because a lapse can pause the team-side rewards you have worked to build. If an entry looks wrong, collect the order reference and ask your upline or support instead of guessing.

The plan is not a get-rich-quick scheme. It is a set of rules that pays only when real products are sold and the business is maintained.`,
    takeaways: [
      'Pending → Released → Paid is the normal commission lifecycle.',
      'Refunds and reversals claw commission back.',
      'Your in-app ledger is the single source of truth — review it weekly.',
      'Keep your account qualified so team-side rewards are not interrupted.',
    ],
    transcript:
      'Video summary (not verbatim) — Wealthanize explains common network-marketing compensation plans and how pay is calculated. The lesson connects the concepts to MarketSpase: an order creates a pending commission, approval releases it, refunds or reversals void it, and the member ledger is the auditable record. Check it weekly and keep your account qualified.',
    quiz: [
      {
        q: 'A new commission starts as…',
        options: ['Released', 'Pending', 'Paid'],
        answer: 1,
      },
      {
        q: 'A Pending commission becomes Released when…',
        options: ['The order is approved', 'You ask your upline', 'The month ends'],
        answer: 0,
      },
      {
        q: 'A refunded or reversed order means the commission is…',
        options: ['Doubled as a bonus', 'Voided or clawed back', 'Ignored forever'],
        answer: 1,
      },
      {
        q: 'Where should you confirm what you actually earned?',
        options: ['Your ledger in the app', 'A screenshot from someone else', 'Word of mouth'],
        answer: 0,
      },
      {
        q: 'How often should you review your ledger?',
        options: ['Weekly', 'Once a year', 'Never'],
        answer: 0,
      },
    ],
  },
  {
    title: 'The first step: become a professional',
    summary: 'The standard behind lasting success: skills, follow-up and service. Video: Eric Worre.',
    youtubeId: 'Hbne5qAI1FI',
    durationSec: 545,
    body: `The first step is not a clever script. It is deciding to become a professional. Professionals learn the product, keep promises, follow up on time, and treat every prospect with respect. They do not chase, pressure or exaggerate.

Your reputation is the real asset. A prospect may say no today, but they will remember how you handled it. A customer may buy once; good service brings them back. A teammate may struggle; consistent coaching keeps them in the game.

Build three habits: learn daily (one product fact, one plan concept, one customer story), talk daily (start conversations, listen more than you pitch, record the next action), and follow up daily (do what you said, when you said it).

Do not wait until you feel ready. Readiness comes from repetition. Your upline is your coach; ask for help early, watch them work, and practise until the basics feel normal.`,
    takeaways: [
      'Professionalism is a habit: learn, talk, follow up.',
      'Your reputation grows every time you keep a promise.',
      'A “no” is redirection, not rejection.',
      'Do the basics until they feel normal, then teach them to your team.',
    ],
    transcript:
      'Video summary (not verbatim) — Eric Worre explains that lasting network-marketing success begins with becoming a professional: learning the craft, serving people, following up and treating the business with discipline. This lesson applies that standard to MarketSpase conversations, customer service and coaching.',
    quiz: [
      {
        q: 'What is the first professional step?',
        options: ['Learn a clever closing script', 'Decide to become a professional', 'Buy followers'],
        answer: 1,
      },
      {
        q: 'How should a professional treat a “no”?',
        options: ['As redirection and a future follow-up', 'As a personal attack', 'As a reason to stop learning'],
        answer: 0,
      },
      {
        q: 'Which habit belongs in the daily rhythm?',
        options: ['Learn, talk and follow up', 'Wait for perfect confidence', 'Only post on social media'],
        answer: 0,
      },
      {
        q: 'Your upline is best used as…',
        options: ['A coach you ask early and often', 'A boss who does the work for you', 'Someone to avoid'],
        answer: 0,
      },
    ],
  },
  {
    title: 'Your first 30 days',
    summary: 'A simple, repeatable rhythm for week one and the rest of your first month. Video: Sandro Cazzato.',
    youtubeId: 'Ee6jWe4viyU',
    durationSec: 640,
    body: `Your first 30 days are not about being perfect. They are about building a rhythm you can repeat. Week one is foundation week: finish IPO, complete your profile, write down 50 people you can serve, and book a session with your upline.

Weeks two to four are rhythm weeks. Present the products or opportunity every day, follow up warmly, and log every touch in the CRM. Attend team training, review your numbers against your calendar, and keep your list growing. Small actions, done daily, compound faster than occasional big pushes.

Expect no. A no is information and redirection, not rejection. Thank the person, note the follow-up date, and move to the next conversation. On hard days, call your coach instead of going silent. Duplication begins when your first teammate can copy what they see you do.

At day 30, review: Did you finish the training? Did you create a daily conversation habit? Did you log your follow-ups? Did you keep your commitments? A yes to those questions is more valuable than a lucky launch.`,
    takeaways: [
      'Week one: finish IPO, set up your profile, list 50 people and book your upline session.',
      'Weeks two to four: present daily, follow up, log every touch and attend training.',
      'Rejection is redirection. Never go silent; call your coach.',
      'A consistent first 30 days compounds into a stronger first year.',
    ],
    transcript:
      'Video summary (not verbatim) — Sandro Cazzato discusses how the first 30 days shape the trajectory of a network-marketing business. The lesson turns it into a simple MarketSpase plan: foundation week, a daily conversation and follow-up rhythm, weekly review, and visible duplication.',
    quiz: [
      {
        q: 'What should week one focus on?',
        options: ['Foundation: training, profile, 50 names and an upline session', 'Mass recruiting everyone you know', 'Running paid ads'],
        answer: 0,
      },
      {
        q: 'What is the daily rhythm for weeks two to four?',
        options: ['Present, follow up and log every touch', 'Wait for inbound leads', 'Only follow up on Mondays'],
        answer: 0,
      },
      {
        q: 'What should you do when someone says no?',
        options: ['Thank them, note a follow-up and keep moving', 'Argue until they agree', 'Delete their number'],
        answer: 0,
      },
      {
        q: 'What makes duplication possible?',
        options: ['Doing the basics visibly so a teammate can copy you', 'Keeping your methods secret', 'Waiting until you are famous'],
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
  throw new Error('No admin account found — create the admin user before seeding the Academy');
}

const now = new Date();
const audit = new MongoAuditStore();

let course = await TrainingCourseModel.findOne({
  $or: [{ title: COURSE.title }, { milestone: COURSE.milestone }],
}).sort({ sortOrder: 1 });

let courseCreated = false;
if (!course) {
  course = await TrainingCourseModel.create({
    ...COURSE,
    sortOrder: 0,
    publishedAt: now,
    createdBy: admin._id,
    updatedBy: admin._id,
  });
  courseCreated = true;
} else {
  course = await TrainingCourseModel.findByIdAndUpdate(
    course._id,
    {
      $set: {
        ...COURSE,
        publishedAt: course.publishedAt ?? now,
        updatedBy: admin._id,
        createdBy: course.createdBy ?? admin._id,
      },
    },
    { new: true },
  );
}

await audit.record({
  actorId: String(admin._id),
  action: courseCreated ? 'training.course.create' : 'training.course.update',
  targetType: 'course',
  targetId: String(course._id),
  detail: {
    title: COURSE.title,
    milestone: COURSE.milestone,
    status: COURSE.status,
    source: 'seed:ipo',
  },
});

let lessonCreatedCount = 0;
let lessonUpdatedCount = 0;
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
    updatedBy: admin._id,
  };
  const existing = await TrainingLessonModel.findOne({ courseId: course._id, title: lesson.title });
  const saved = existing
    ? await TrainingLessonModel.findByIdAndUpdate(
      existing._id,
      { $set: { ...payload, createdBy: existing.createdBy ?? admin._id } },
      { new: true },
    )
    : await TrainingLessonModel.create({ ...payload, createdBy: admin._id });
  if (existing) lessonUpdatedCount += 1;
  else lessonCreatedCount += 1;
  await audit.record({
    actorId: String(admin._id),
    action: existing ? 'training.lesson.update' : 'training.lesson.create',
    targetType: 'lesson',
    targetId: String(saved._id),
    detail: {
      courseId: String(course._id),
      title: lesson.title,
      youtubeId: lesson.youtubeId,
      status: 'published',
      source: 'seed:ipo',
    },
  });
}

const publishedLessons = await TrainingLessonModel.countDocuments({
  courseId: course._id,
  status: 'published',
});
const courseId = String(course._id);
const lessonSummary = await TrainingLessonModel.find({ courseId: course._id })
  .sort({ sortOrder: 1 })
  .select('title youtubeId durationSec status sortOrder')
  .lean();

console.log(JSON.stringify({
  database: db,
  admin: { id: String(admin._id), username: admin.username },
  course: {
    id: courseId,
    title: COURSE.title,
    status: COURSE.status,
    milestone: COURSE.milestone,
    created: courseCreated,
    publishedLessons,
  },
  lessons: lessonSummary.map((lesson) => ({
    id: String(lesson._id),
    title: lesson.title,
    youtubeId: lesson.youtubeId,
    durationSec: lesson.durationSec,
    status: lesson.status,
    sortOrder: lesson.sortOrder,
  })),
  counts: {
    lessonsCreated: lessonCreatedCount,
    lessonsUpdated: lessonUpdatedCount,
  },
}, null, 2));

await mongoose.connection.close(false);
