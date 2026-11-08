import 'dotenv/config';
import './src/shared/mongo/queryTimeout.js';
import express from 'express';
import http from 'http';
import mongoose from 'mongoose';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import PartnerRouter from './src/apps/partner/index.js';
import BookingRouter from './src/apps/booking/index.js';
import CampaignRouter from './src/apps/campaign/index.js';
import ContactV1Router from './src/apps/contact/routes/Contact.routes.js';
import TransactionRouter from './src/apps/transaction/index.js';
import ProspectRouter from './src/apps/prospect/index.js';
import ProductRouter from './src/apps/product/index.js';
import SurveyV1Router from './src/apps/survey/routes/Survey.routes.js';
import EmailSubscriptionV1Router from './src/apps/email-subscription/routes/EmailSubscription.routes.js';
import LegacyEmailSubscriptionRouter from './src/apps/email-subscription/routes/LegacyEmailSubscription.routes.js';

import EmailRouter from './src/apps/email/index.js';
import SmsRouter from './src/apps/sms/index.js';
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
import { buildAdminRankGroupsRouter } from './src/modules/messaging/interface/AdminRankGroups.routes.js';
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
import RecycleBinRouter from './src/modules/recycle-bin/interface/RecycleBin.routes.js';
import { ensureSeedBonus } from './src/modules/bonuses/index.js';
import { subscribeActivation } from './src/modules/activation/index.js';
import { subscribePromotionFanout } from './src/modules/notifications/application/PromotionFanout.js';
import { subscribeGoalFanout } from './src/modules/notifications/application/GoalFanout.js';
import { subscribeContactListFanout } from './src/modules/notifications/application/ContactListFanout.js';
import { subscribeProspectWorkedFanout } from './src/modules/notifications/application/ProspectWorkedFanout.js';
import { subscribeStoreOrderFanout } from './src/modules/notifications/application/StoreOrderFanout.js';
import { subscribeRankGroupFanout } from './src/modules/notifications/application/RankGroupFanout.js';
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
import { attachMessagingGateway, broadcastRankGroupChanged } from './src/modules/messaging/interface/Messaging.gateway.js';
import { MongoGroupStore } from './src/modules/messaging/infrastructure/Group.mongo.repository.js';
import { RankGroupService } from './src/modules/messaging/application/RankGroups.service.js';
import { RANK_GROUP_EVENTS } from './src/modules/messaging/domain/RankGroups.js';
import { MongoProgressionStore } from './src/modules/progression/infrastructure/Progression.mongo.repository.js';
import { PROGRESSION_EVENTS } from './src/modules/progression/domain/ProgressionEvents.js';
import { MongoOutbox } from './src/shared/outbox/Outbox.mongo.model.js';
import { requestContext } from './src/shared/http/requestContext.js';
import { safeErrorResponses } from './src/shared/http/safeErrorResponses.js';
import { csrfGuard } from './src/shared/http/csrfGuard.js';
import { allowedOrigins } from './src/shared/http/origins.js';
import { buildHealthRouter } from './src/shared/http/health.routes.js';
import { logger } from './src/shared/observability/logger.js';

let messagingGateway = null;

const rankGroupService = new RankGroupService({
  groups: new MongoGroupStore(),
  progress: new MongoProgressionStore(),
  onChanged: (payload) => domainEvents.emit(RANK_GROUP_EVENTS.CHANGED, payload),
});

const requestedPort = process.env.PORT ?? '8080';
const port = Number(requestedPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  logger.error('invalid_port', { port: requestedPort });
  process.exit(1);
}
const app = express();

// Trust exactly the configured number of proxy hops. Default 0 because
// trusting a raw X-Forwarded-For header lets clients forge their IP and
// bypass rate limits. Production behind one load balancer: TRUST_PROXY_HOPS=1.
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (Number.isInteger(trustProxyHops) && trustProxyHops > 0) {
  app.set('trust proxy', trustProxyHops);
}
app.disable('x-powered-by');

// Security headers. The API serves JSON and cross-origin uploads, so keep
// CSP off (the web apps own their CSP) and allow cross-origin resources.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(compression());
app.use(requestContext);

// Capture raw bytes for provider webhooks (Paystack signs the raw body).
app.use(express.json({
  limit: process.env.JSON_BODY_LIMIT || '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: false, limit: process.env.FORM_BODY_LIMIT || '1mb' }));
app.use(cookieParser());
app.use(safeErrorResponses);
app.use(csrfGuard);

// Health endpoints stay outside auth and are safe for load balancers.
app.use('/health', buildHealthRouter());

// Extra web origins (comma-separated) for new subdomains without a code
// change, e.g. EXTRA_CORS_ORIGINS=https://join.c21fg.online. Localhost
// ports stay so dev builds just work.
app.use(cors({
  credentials: true,
  origin: allowedOrigins(),
}));

/* Routes */
app.get('/', (req, res) => res.send('Node server is up and running'));
// Legacy auth surface retired — /v1/auth owns signin, signout, refresh, reset
// and session checks. Keeping the old mount would duplicate credential paths.
app.use('/partners', PartnerRouter);
app.use('/booking', BookingRouter);
app.use('/campaign', CampaignRouter);
app.use('/billing', TransactionRouter);
app.use('/prospect', ProspectRouter);
app.use('/products', ProductRouter);

app.use('/emails', EmailRouter);
app.use('/sms', SmsRouter);
app.use('/team', TeamsRouter);
/* DDD v1 (new, strangler) — same data, validated boundary */
app.use('/v1/tickets', TicketV1Router);
app.use('/v1/contact', ContactV1Router);
app.use('/v1/survey', SurveyV1Router);
app.use('/v1/email-subscription', EmailSubscriptionV1Router);
// Temporary redirects for confirmation/unsubscribe links already sent by email.
// Remove after the legacy audit shows no /emailSubscription traffic.
app.use('/emailSubscription', LegacyEmailSubscriptionRouter);
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
app.use('/v1/admin/rank-groups', buildAdminRankGroupsRouter({ rankGroups: rankGroupService }));
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
app.use('/v1/messages', buildGroupRouter({ rankGroups: rankGroupService }));
app.use('/v1/progression', ProgressionRouter);
app.use('/v1/training', TrainingRouter);
app.use('/v1/admin/training', AdminTrainingRouter);
app.use('/v1/admin/audit', AuditRouter);
app.use('/v1/admin/jobs', JobHealthRouter);
app.use('/v1/admin/recycle-bin', RecycleBinRouter);
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
  const lifecycleOutbox = new MongoOutbox();
  const lifecycleDelivery = new NotificationDeliveryService({
    stored: lifecycleStore,
    notify: new NotifyUseCase({ stored: lifecycleStore }),
    mail: sendEmail,
    sms: buildSmsSender(env.sms),
    push: buildPushSender(env.push, env.appBaseUrl),
    outbox: lifecycleOutbox,
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
  // Official level-group moves: store an in-app notification and, when the
  // partner is online, move their sockets into the new group room and tell
  // the Messages UI to refresh without a page reload.
  subscribeRankGroupFanout({
    events: domainEvents,
    notify: new NotifyUseCase({ stored: lifecycleStore }),
  });
  domainEvents.on(RANK_GROUP_EVENTS.CHANGED, (payload) => {
    broadcastRankGroupChanged(messagingGateway, payload);
  });
  // Level group membership follows the persisted journey rank. Promotion
  // events move immediately; the daily sweep repairs demotions and drift.
  domainEvents.on(PROGRESSION_EVENTS.PROMOTED, (payload) => {
    void rankGroupService.syncPartner(payload?.partnerId).catch((error) => {
      logger.warn('rank_group_sync_failed', {
        partnerId: payload?.partnerId ?? null,
        error: error?.message ?? String(error),
      });
    });
  });
  // Allocation is automatic: a newly activated partner or newly activated
  // campaign immediately kicks the growth-campaign placement sweep. The
  // 15-minute cron remains the safety net.
  domainEvents.on('partner.activated', () => {
    void runGrowthAllocationDueJob().catch((error) => {
      logger.warn('growth_allocation_trigger_failed', {
        trigger: 'partner.activated',
        error: error?.message ?? String(error),
      });
    });
  });
  domainEvents.on('campaign.activated', () => {
    void runGrowthAllocationDueJob().catch((error) => {
      logger.warn('growth_allocation_trigger_failed', {
        trigger: 'campaign.activated',
        error: error?.message ?? String(error),
      });
    });
  });
}

/* DB connection */
let httpServer = null;
let shuttingDown = false;

const envMs = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const closeHttpServer = async () => {
  if (!httpServer) return;
  if (!httpServer.listening) {
    try {
      httpServer.close();
    } catch { /* the server never reached listen */ }
    return;
  }

  await new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      httpServer.close(done);
    } catch {
      done();
    }
    if (typeof httpServer.closeIdleConnections === 'function') {
      httpServer.closeIdleConnections();
    }
    setTimeout(() => {
      if (typeof httpServer.closeAllConnections === 'function') {
        httpServer.closeAllConnections();
      }
      done();
    }, 10000).unref();
  });
};

const closeMongo = async () => {
  if (mongoose.connection.readyState === 0) return;
  await Promise.race([
    mongoose.connection.close(false).catch(() => null),
    new Promise((resolve) => setTimeout(resolve, 5000).unref()),
  ]);
};

const shutdown = async (signal, exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown_started', { signal });
  try {
    await closeHttpServer();
    await closeMongo();
    logger.info('shutdown_complete', { signal });
    process.exit(exitCode);
  } catch (error) {
    logger.error('shutdown_failed', { signal, error: error?.message ?? String(error) });
    process.exit(1);
  }
};

const onServerError = (error) => {
  const code = error?.code ?? null;
  logger.error(code === 'EADDRINUSE' ? 'port_in_use' : 'server_error', {
    port,
    code,
    error: error?.message ?? String(error),
  });
  void shutdown('server_error', 1);
};

const startBackgroundTasks = async () => {
  try {
    const { created, failed } = await ensureIndexes(mongoose);
    if (!shuttingDown) {
      logger.info('indexes_ensured', { created: created.length, failed: failed.length });
      for (const f of failed) logger.warn('index_failed', { index: f.index, error: f.error });
    }
  } catch (error) {
    if (!shuttingDown) logger.warn('index_ensure_skipped', { error: error?.message ?? String(error) });
  }

  if (shuttingDown) return;

  rankGroupService.ensureGroups().then(
    (result) => logger.info('rank_groups_seeded', { created: result?.created ?? 0, ready: !!result?.ready }),
    (error) => {
      if (!shuttingDown) logger.warn('rank_group_seed_skipped', { error: error?.message ?? String(error) });
    },
  );

  if (shuttingDown) return;

  if (process.env.SKIP_SCHEDULE === '1') {
    logger.warn('schedule_skipped', { reason: 'SKIP_SCHEDULE=1' });
  } else {
    try {
      scheduleJobs();
    } catch (error) {
      logger.error('schedule_jobs_failed', { error: error?.message ?? String(error) });
    }
  }

  if (shuttingDown) return;

  ensureSeedBonus().then(
    (r) => logger.info('bonus_seed', { seeded: r.seeded, retired: r.retired, id: r.id ?? null }),
    (error) => {
      if (!shuttingDown) logger.warn('bonus_seed_skipped', { error: error?.message ?? String(error) });
    },
  );
  ensureStarterProduct().then(
    (r) => logger.info('starter_product_seed', { seeded: r.seeded, id: r.id ?? null }),
    (error) => {
      if (!shuttingDown) logger.warn('starter_product_seed_skipped', { error: error?.message ?? String(error) });
    },
  );
};

if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => void shutdown('SIGTERM', 0));
  process.on('SIGINT', () => void shutdown('SIGINT', 0));
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandled_rejection', {
      error: reason?.message ?? String(reason),
      stack: reason?.stack,
    });
    void shutdown('unhandledRejection', 1);
  });
  process.on('uncaughtException', (error) => {
    logger.error('uncaught_exception', { error: error?.message ?? String(error), stack: error?.stack });
    void shutdown('uncaughtException', 1);
  });
}

const mongoUri = process.env.MONGODB_URI
  || `mongodb+srv://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@cluster0.ab5nviz.mongodb.net/${process.env.MONGODB_DATABASE}?retryWrites=true&w=majority`;

const bootServer = () => {
  try {
    logger.info('mongo_connected');
    httpServer = http.createServer(app);
    httpServer.keepAliveTimeout = envMs('KEEP_ALIVE_TIMEOUT_MS', 65000);
    httpServer.headersTimeout = Math.max(
      envMs('HEADERS_TIMEOUT_MS', 66000),
      httpServer.keepAliveTimeout + 1000,
    );
    httpServer.requestTimeout = envMs('REQUEST_TIMEOUT_MS', 120000);
    httpServer.on('error', onServerError);
    messagingGateway = attachMessagingGateway(httpServer, { groups: new MongoGroupStore() });

    httpServer.listen(port, () => {
      logger.info('server_started', { port });
      // Index builds, cron registration and seeds run only after the port is
      // bound, so a listen failure never tears down Mongo mid-boot.
      void startBackgroundTasks().catch((error) => {
        logger.error('boot_tasks_failed', { error: error?.message ?? String(error) });
      });
    });
  } catch (error) {
    logger.error('server_boot_failed', { port, error: error?.message ?? String(error) });
    void shutdown('server_boot_failed', 1);
  }
};

const connect = async () => {
  try {
    await mongoose.connect(mongoUri);
  } catch (error) {
    logger.error('mongo_connect_failed', { error: error?.message ?? String(error), stack: error?.stack });
    await shutdown('mongo_connect_failed', 1);
    return;
  }
  bootServer();
};

void connect();
