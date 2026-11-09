/**
 * Ora capability map — every partner-facing area Ora can explain or operate.
 *
 * `open_page` is safe and always available. Pipeline surfaces additionally
 * allow approved follow-up scheduling and stage moves. Bulk SMS/email outreach
 * was retired; Ora never sends messages.
 * Keep this list aligned with `dashboard.routes.ts` and `nav.config.ts`.
 */
export const ORA_ACTION_TYPES = Object.freeze([
  'open_page',
  'schedule_followup',
  'advance_stage',
  'save_daily_plan',
]);

const cap = (key, area, title, page, actions, description) => ({
  key,
  area,
  title,
  page,
  actions,
  description,
  requiresApproval: actions.some((action) => action !== 'open_page'),
});

const OPEN = ['open_page'];
const PIPELINE = ['open_page', 'schedule_followup', 'advance_stage'];

export const ORA_CAPABILITIES = Object.freeze([
  cap('home.today', 'Home', 'Today’s plan and business status', '/dashboard', OPEN, 'Summarise priorities, pipeline, goals, wallet and next steps.'),
  cap('home.plan', 'Home', "Today's plan", '/dashboard/ora', ['open_page', 'save_daily_plan'], 'Create or edit the day plan and track its focus items.'),
  cap('pipeline.hub', 'Pipeline', 'Pipeline overview', '/dashboard/pipeline', OPEN, 'Show who needs attention today.'),
  cap('pipeline.followups', 'Pipeline', 'Follow-ups', '/dashboard/prospects/pipeline', PIPELINE, 'Read, message, schedule and advance prospects.'),
  cap('pipeline.reminders', 'Pipeline', 'Follow-up reminders', '/dashboard/prospects/reminders', PIPELINE, 'Work promises due today or overdue.'),
  cap('pipeline.board', 'Pipeline', 'Deal board', '/dashboard/prospects/board', ['open_page', 'advance_stage'], 'Move deals between stages.'),
  cap('pipeline.customer-leads', 'Pipeline', 'Customer leads', '/dashboard/prospects/customer-leads', OPEN, 'Review store checkout customers.'),
  cap('team.hub', 'Team', 'Team overview', '/dashboard/team', OPEN, 'Show who needs coaching or activation.'),
  cap('team.activation', 'Team', 'Activation board', '/dashboard/mentorship/team/activation', OPEN, 'Track new partners waiting to activate.'),
  cap('team.partners', 'Team', 'My partners', '/dashboard/mentorship/partners/my-partners', OPEN, 'Review direct partners and follow-ups.'),
  cap('team.tree', 'Team', 'Team tree', '/dashboard/network/tree', OPEN, 'Explore the network structure.'),
  cap('onboarding.activate', 'Activation', 'Activate your partner account', '/dashboard/activate', OPEN, 'Complete wallet activation and KYC steps.'),
  cap('campaigns.fund', 'Campaigns', 'Partner acquisition campaigns', '/dashboard/campaigns', OPEN, 'Plan or review funded acquisition campaigns.'),
  cap('promote.hub', 'Promote', 'Promote hub', '/dashboard/promote', OPEN, 'Share the page, content and outreach tools.'),
  cap('promote.page', 'Promote', 'Public page', '/dashboard/settings/landing-page', OPEN, 'Review and improve the public one-pager.'),
  cap('promote.content', 'Promote', 'Content library', '/dashboard/resources/ads-contents', OPEN, 'Find share-ready ads and captions.'),
  cap('promote.guides', 'Promote', 'Prospecting guides', '/dashboard/resources/prospecting-contents', OPEN, 'Open conversation frameworks and scripts.'),
  cap('wallet.home', 'Wallet', 'Wallet overview', '/dashboard/wallet', OPEN, 'Check balance, earnings and pending funds.'),
  cap('wallet.history', 'Wallet', 'Transactions', '/dashboard/wallet/history', OPEN, 'Review the ledger and withdrawals.'),
  cap('wallet.deposit', 'Wallet', 'Deposit funds', '/dashboard/wallet/deposit', OPEN, 'Top up the wallet or resume a pending deposit.'),
  cap('wallet.compensation', 'Wallet', 'Compensation', '/dashboard/compensation', OPEN, 'Review rank, commissions and mentor bonus.'),
  cap('wallet.billing', 'Wallet', 'Billing and withdrawals', '/dashboard/settings/billing', OPEN, 'Manage bank details and withdrawal state.'),
  cap('products.catalog', 'Products', 'Product catalogue', '/dashboard/products', OPEN, 'Browse products for use or resale.'),
  cap('products.my-store', 'Products', 'My store', '/dashboard/products/my-store', OPEN, 'Review store status and listings.'),
  cap('products.store-orders', 'Products', 'Store orders', '/dashboard/products/store-orders', OPEN, 'Fulfil orders and check escrow.'),
  cap('products.resell', 'Products', 'Resell', '/dashboard/products/resell', OPEN, 'Review partner pricing and resale margin.'),
  cap('products.orders', 'Products', 'My orders', '/dashboard/products/order-history', OPEN, 'Track orders, delivery and reorders.'),
  cap('products.guides', 'Products', 'Product guides', '/dashboard/products/guides', OPEN, 'Explain buying, delivery and product care.'),
  cap('products.checkout', 'Products', 'Checkout', '/dashboard/checkout', OPEN, 'Review the cart and wallet checkout.'),
  cap('learn.hub', 'Learn', 'Learn hub', '/dashboard/learn', OPEN, 'Pick the next training step.'),
  cap('learn.progress', 'Learn', 'Progress', '/dashboard/progress', OPEN, 'Explain rank and journey progress.'),
  cap('learn.goals', 'Learn', 'Goals', '/dashboard/goals', OPEN, 'Review goals, pace and at-risk targets.'),
  cap('learn.courses', 'Learn', 'Courses', '/dashboard/training/courses', OPEN, 'Recommend the next course.'),
  cap('learn.library', 'Learn', 'Library', '/dashboard/training/library', OPEN, 'Find training resources.'),
  cap('learn.tutorials', 'Learn', 'Tutorials', '/dashboard/training/tutorials', OPEN, 'Find how-to tutorials.'),
  cap('learn.analytics', 'Learn', 'Training analytics', '/dashboard/training/analytics', OPEN, 'Review training completion and progress.'),
  cap('community.hub', 'Community', 'Community hub', '/dashboard/community', OPEN, 'Show feed, events and recognition.'),
  cap('community.feed', 'Community', 'Community feed', '/dashboard/community/feed', OPEN, 'Summarise posts and recognition.'),
  cap('community.events', 'Community', 'Events', '/dashboard/community/events', OPEN, 'Review upcoming events and RSVPs.'),
  cap('community.messages', 'Community', 'Messages', '/dashboard/messages', OPEN, 'Check team and direct messages.'),
  cap('notifications.center', 'Notifications', 'Notification centre', '/dashboard/notifications/center', OPEN, 'Review alerts and unread items.'),
  cap('insights.home', 'Insights', 'Business insights', '/dashboard/insights', OPEN, 'Explain business performance and reports.'),
  cap('insights.my-business', 'Insights', 'My business', '/dashboard/insights/my-business', OPEN, 'Explain personal numbers and next moves.'),
  cap('insights.downloads', 'Insights', 'Reports and downloads', '/dashboard/insights/downloads', OPEN, 'Export business data.'),
  cap('support.ticket', 'Support', 'Support ticket', '/dashboard/support/ticket', OPEN, 'Open help or raise a ticket.'),
  cap('support.about', 'Support', 'About MarketSpase', '/dashboard/support/about/app', OPEN, 'Explain how the platform works.'),
  cap('settings.profile', 'Settings', 'Profile settings', '/dashboard/settings/profiles', OPEN, 'Review profile and security settings.'),
  cap('more.hub', 'More', 'More and account', '/dashboard/more', OPEN, 'Find account utilities and help.'),
  cap('ora.chat', 'Ora', 'Ora conversation', '/dashboard/ora', OPEN, 'Open the full Ora workspace.'),
]);

export const CAPABILITY_BY_KEY = new Map(ORA_CAPABILITIES.map((item) => [item.key, item]));

export const capabilityForPage = (page) => ORA_CAPABILITIES.find((item) => item.page === page) ?? null;

export const capabilityByKey = (key) => CAPABILITY_BY_KEY.get(String(key ?? '')) ?? null;

/** Compact key/title index for the model prompt. */
export const formatCapabilityIndex = () => ORA_CAPABILITIES
  .map((item) => `${item.key}=${item.title}`)
  .join('; ');
