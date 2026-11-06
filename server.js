import 'dotenv/config';
import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import AuthRouter from './src/apps/auth/index.js';
import PartnerRouter from './src/apps/partner/index.js';
import BookingRouter from './src/apps/booking/index.js';
import CampaignRouter from './src/apps/campaign/index.js';
import ContactRouter from './src/apps/contact/index.js';
import TransactionRouter from './src/apps/transaction/index.js';
import ProspectRouter from './src/apps/prospect/index.js';
import ProductRouter from './src/apps/product/index.js';
import SurveyRouter from './src/apps/survey/index.js';
import EmailSubscriptionRouter from './src/apps/email-subscription/index.js';

import EmailRouter from './src/apps/email/index.js';
import SmsRouter from './src/apps/sms/index.js';
import TicketRouter from './src/apps/ticket/index.js';
import TeamsRouter from './src/apps/teams/index.js';

// Strangler Fig: DDD slices (new) mounted alongside legacy routers
import TicketV1Router from './src/modules/support-ticketing/index.js';
import AuthV1Router, { AdminRouter } from './src/modules/identity-access/index.js';
import OnboardingRouter, { buildAdminOnboardingRouter, ensureStarterProduct } from './src/modules/onboarding/index.js';
import CampaignsRouter, { buildAdminCampaignRouter } from './src/modules/campaigns/index.js';
import CompensationRouter, { buildAdminCompensationRouter, subscribeCompensation } from './src/modules/compensation/index.js';
import NetworkRouter from './src/modules/network/index.js';
import BillingRouter from './src/modules/billing/index.js';
import NotificationsRouter from './src/modules/notifications/index.js';
import GoalsRouter from './src/modules/goals/index.js';
import AnalyticsRouter from './src/modules/analytics/index.js';
import SearchRouter from './src/modules/search/index.js';
import DashboardRouter from './src/modules/dashboard/index.js';
import ReportsRouter from './src/modules/reports/index.js';
import ExportsRouter from './src/modules/exports/index.js';
import MessagingRouter from './src/modules/messaging/index.js';
import { buildGroupRouter } from './src/modules/messaging/interface/Group.routes.js';
import ProgressionRouter from './src/modules/progression/index.js';
import TrainingRouter from './src/modules/training/index.js';
import AdminTrainingRouter from './src/modules/training/interface/AdminTraining.routes.js';
import DepositRouter from './src/modules/billing/interface/Deposit.routes.js';
import AuditRouter from './src/modules/audit/index.js';
import BroadcastRouter from './src/modules/broadcast/index.js';
import CoachingRouter from './src/modules/coaching/index.js';
import CommunityRouter from './src/modules/community/index.js';
import MarketingRouter from './src/modules/marketing/index.js';
import EventsRouter from './src/modules/events/index.js';
import OraRouter from './src/modules/ora/index.js';
import SettingsV1Router from './src/modules/settings/index.js';
import StoresRouter from './src/modules/stores/index.js';
import AdminStoreRouter from './src/modules/stores/interface/AdminStore.routes.js';
import OutreachRouter from './src/modules/outreach/index.js';
import SubscriptionsRouter from './src/modules/subscriptions/index.js';
import { buildAdminBonusRouter, buildBonusRouter } from './src/modules/bonuses/interface/Bonus.routes.js';
import { buildAdminTutorialRouter, buildTutorialRouter } from './src/modules/tutorials/interface/Tutorial.routes.js';
import { buildAdminKitRouter, buildKitRouter } from './src/modules/kits/interface/Kit.routes.js';
import JobHealthRouter from './src/jobs/JobHealth.routes.js';
import { ensureSeedBonus } from './src/modules/bonuses/index.js';
import { subscribeActivation } from './src/modules/activation/index.js';
import { subscribePromotionFanout } from './src/modules/notifications/application/PromotionFanout.js';
import { subscribeGoalFanout } from './src/modules/notifications/application/GoalFanout.js';
import { subscribeContactListFanout } from './src/modules/notifications/application/ContactListFanout.js';
import { subscribeProspectWorkedFanout } from './src/modules/notifications/application/ProspectWorkedFanout.js';
import { subscribeStoreOrderFanout } from './src/modules/notifications/application/StoreOrderFanout.js';
import { domainEvents } from './src/shared/events/DomainEvents.js';
import { env } from './src/shared/config/env.js';
import { sendEmail } from './src/services/emailService.js';
import { NotifyUseCase } from './src/modules/notifications/application/NotificationsCenter.usecases.js';
import { NotificationDeliveryService } from './src/modules/notifications/application/NotificationDelivery.js';
import { MongoStoredNotificationStore } from './src/modules/notifications/infrastructure/StoredNotifications.mongo.repository.js';
import { MongoPartnerRepository } from './src/modules/identity-access/infrastructure/Auth.mongo.repository.js';
import { MongoNetworkRepository } from './src/modules/network/infrastructure/Network.mongo.repository.js';
import { buildSmsSender } from './src/modules/notifications/infrastructure/SmsSender.js';
import { buildPushSender } from './src/modules/notifications/infrastructure/PushSender.js';
import ProspectV1Router from './src/modules/crm/index.js';
import PagesRouter from './src/modules/partner-pages/interface/Pages.routes.js';
import PartnerSurveysRouter from './src/modules/partner-surveys/interface/Surveys.routes.js';
import { errorMiddleware } from './src/shared/http/errorMiddleware.js';
import { ensureIndexes } from './src/shared/mongo/indexes.js';
import { scheduleJobs } from './src/jobs/schedule.js';
import { runGrowthAllocationDueJob } from './src/jobs/growth-allocation-due.js';
import { attachMessagingGateway } from './src/modules/messaging/interface/Messaging.gateway.js';
import { MongoGroupStore } from './src/modules/messaging/infrastructure/Group.mongo.repository.js';

const port = process.env.PORT || 8080;
const app = express();
// Capture raw bytes for provider webhooks (Paystack signs the raw body).
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; },
})); // Use json middleware
app.use(express.urlencoded({extended: false})); // Use formdata middleware
app.use(cookieParser());
// Extra web origins (comma-separated) for new subdomains without a code
// change, e.g. EXTRA_CORS_ORIGINS=https://join.c21fg.online. Localhost
// ports stay so dev builds just work.
const extraOrigins = String(process.env.EXTRA_CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors({
    credentials: true,
    origin: [
        'http://localhost:4200', 
        'http://localhost:4201', 
        'http://localhost:4202',
        'http://localhost:4203',
        'https://c21fg.online',
        'https://www.c21fg.online',
        'https://marketspase.com',
        'https://www.marketspase.com',
        'https://admin.marketspase.com',
        'https://survey.c21fg.online',
        'https://shop.c21fg.online',
        'https://diamondproject.c21fg.online',
        ...extraOrigins,
    ]
}));

/* Routes */
app.get('/', (req, res) => res.send('Node server is up and running'));
app.use('/auth', AuthRouter);
app.use('/partners', PartnerRouter);
app.use('/booking', BookingRouter);
app.use('/campaign', CampaignRouter);
app.use('/contact', ContactRouter);
app.use('/billing', TransactionRouter);
app.use('/prospect', ProspectRouter);
app.use('/products', ProductRouter);
app.use('/survey', SurveyRouter);
app.use('/emailSubscription', EmailSubscriptionRouter);

app.use('/emails', EmailRouter);
app.use('/sms', SmsRouter);
app.use('/ticket', TicketRouter);
app.use('/team', TeamsRouter);
/* DDD v1 (new, strangler) — same data, validated boundary */
app.use('/v1/tickets', TicketV1Router);
app.use('/v1/auth', AuthV1Router);
app.use('/v1/prospects', ProspectV1Router);
app.use('/v1/admin/pages', PagesRouter);
app.use('/v1/admin/partner-surveys', PartnerSurveysRouter);
app.use('/v1/onboarding', OnboardingRouter);
app.use('/v1/admin/onboarding', buildAdminOnboardingRouter());
app.use('/v1/campaigns', CampaignsRouter);
app.use('/v1/admin/campaigns', buildAdminCampaignRouter());
app.use('/v1/compensation', CompensationRouter);
app.use('/v1/admin/compensation', buildAdminCompensationRouter());
app.use('/v1/admin', AdminRouter);
app.use('/v1/admin', AdminStoreRouter);
app.use('/v1/network', NetworkRouter);
app.use('/v1/billing', DepositRouter);
app.use('/v1/billing', BillingRouter);
app.use('/v1/notifications', NotificationsRouter);
app.use('/v1/goals', GoalsRouter);
app.use('/v1/analytics', AnalyticsRouter);
app.use('/v1/search', SearchRouter);
app.use('/v1/dashboard', DashboardRouter);
app.use('/v1/reports', ReportsRouter);
app.use('/v1/exports', ExportsRouter);
app.use('/v1/messages', MessagingRouter);
app.use('/v1/messages', buildGroupRouter());
app.use('/v1/progression', ProgressionRouter);
app.use('/v1/training', TrainingRouter);
app.use('/v1/admin/training', AdminTrainingRouter);
app.use('/v1/admin/audit', AuditRouter);
app.use('/v1/admin/jobs', JobHealthRouter);
app.use('/v1/admin/broadcast', BroadcastRouter);
app.use('/v1/coaching', CoachingRouter);
app.use('/v1/community', CommunityRouter);
app.use('/v1/marketing', MarketingRouter);
app.use('/v1/events', EventsRouter);
app.use('/v1/ora', OraRouter);
app.use('/v1/settings', SettingsV1Router);
app.use('/v1/stores', StoresRouter);
app.use('/v1/outreach', OutreachRouter);
app.use('/v1/admin/subscriptions', SubscriptionsRouter);
app.use('/v1/bonuses', buildBonusRouter());
app.use('/v1/admin/bonuses', buildAdminBonusRouter());
app.use('/v1/tutorials', buildTutorialRouter());
app.use('/v1/admin/tutorials', buildAdminTutorialRouter());
app.use('/v1/kits', buildKitRouter());
app.use('/v1/admin/kits', buildAdminKitRouter());




// Convert `import.meta.url` to `__dirname` equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Serve static files from the "uploads" directory
// RETIRED: legacy disk upload (POST /image/profile/:userId) had no auth,
// no file-type/size limits and wrote to local disk. Profile photos go
// through session-owned POST /v1/settings/profile-image (Cloudinary).
// This static serve stays for previously stored filenames.
app.use('/uploads', express.static(path.join(__dirname, 'src', 'uploads')));

/* Central domain-error map for v1 slices (legacy routes keep their own try/catch) */
app.use(errorMiddleware);

/* Lifecycle fan-out, subscribed ONCE here (never per-router) on the
 * shared bus: signup consume → prospect Converted + upline welcomed +
 * member welcomed; promotions → member + upline notified. */
{
  const lifecycleStore = new MongoStoredNotificationStore();
  const lifecycleDelivery = new NotificationDeliveryService({
    stored: lifecycleStore,
    notify: new NotifyUseCase({ stored: lifecycleStore }),
    mail: sendEmail,
    sms: buildSmsSender(env.sms),
    push: buildPushSender(env.push, env.appBaseUrl),
  });
  const lifecyclePartners = new MongoPartnerRepository();
  subscribeActivation({
    events: domainEvents,
    stored: lifecycleStore,
    notify: new NotifyUseCase({ stored: lifecycleStore }),
    delivery: lifecycleDelivery,
    partners: lifecyclePartners,
  });
  subscribePromotionFanout({
    events: domainEvents,
    stored: lifecycleStore,
    delivery: lifecycleDelivery,
    partners: lifecyclePartners,
    network: new MongoNetworkRepository(),
  });
  subscribeGoalFanout({
    events: domainEvents,
    stored: lifecycleStore,
    delivery: lifecycleDelivery,
    partners: lifecyclePartners,
    network: new MongoNetworkRepository(),
  });
  subscribeContactListFanout({
    events: domainEvents,
    stored: lifecycleStore,
    delivery: lifecycleDelivery,
    partners: lifecyclePartners,
    network: new MongoNetworkRepository(),
  });
  subscribeProspectWorkedFanout({
    events: domainEvents,
    stored: lifecycleStore,
    delivery: lifecycleDelivery,
    partners: lifecyclePartners,
  });
  subscribeStoreOrderFanout({
    events: domainEvents,
    delivery: lifecycleDelivery,
    partners: lifecyclePartners,
    mail: sendEmail,
  });
  subscribeCompensation({ events: domainEvents });
  // Allocation is automatic: a newly activated partner or newly activated
  // campaign immediately kicks the growth-campaign placement sweep. The
  // 15-minute cron remains the safety net.
  domainEvents.on('partner.activated', () => {
    void runGrowthAllocationDueJob().catch(() => null);
  });
  domainEvents.on('campaign.activated', () => {
    void runGrowthAllocationDueJob().catch(() => null);
  });
}

/* DB connection */
const mongoUri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;
mongoose.connect(mongoUri)
.then(async () => {
    // Application Starts Only when MongoDB is connected
    console.log('Connected to mongoDB')
    try {
      const { created, failed } = await ensureIndexes(mongoose);
      console.log(`Indexes ensured: ${created.length} (failed: ${failed.length})`);
      for (const f of failed) console.warn(`Index failed: ${f.index} — ${f.error}`);
    } catch (error) {
      console.warn('Index ensure skipped:', error?.message ?? error);
    }
    scheduleJobs();
    ensureSeedBonus().then(
      (r) => console.log(`[bonuses] seed: ${r.seeded ? `created welcome N2500 (${r.id})` : r.retired ? 'welcome campaign removed — not reseeding' : 'welcome campaign present'}`),
      (error) => console.warn('[bonuses] seed skipped:', error?.message ?? error),
    );
    ensureStarterProduct().then(
      (r) => console.log(`[onboarding] starter product: ${r.seeded ? `created (${r.id})` : 'present'}`),
      (error) => console.warn('[onboarding] starter product seed skipped:', error?.message ?? error),
    );
    const server = http.createServer(app);
    attachMessagingGateway(server, { groups: new MongoGroupStore() });
    server.listen(port, () => {
        console.log(`Server is running on port: http://localhost:${port}`)
    })
}).catch((error) => {
    console.error('Error from mongoDB connection ', error)
})