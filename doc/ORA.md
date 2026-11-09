# Ora — business coach + support operator

Last verified: 2026-11-09

Ora is the platform upline for every member. It combines:

- **Business coach:** reads rank, pipeline, goals, team, wallet, products, training and community state.
- **Support operator:** prepares the next move and asks for approval before acting.

Core rule: **Ora proposes; the partner approves; the backend executes.**

## Approval loop

1. `POST /v1/ora/chat` returns a reply plus safe action cards.
2. Executable cards are stored in `ora-actions` with `status: proposed`.
3. The partner chooses **Approve** or **Skip**.
4. `POST /v1/ora/actions/:id/approve` executes exactly once, records the result and audits it.
5. `GET /v1/ora/actions?status=proposed` powers the full Ora page.

Open-page cards do not need approval.

## Capability map

| Capability key | Page |
| --- | --- |
| `home.today` | `/dashboard` |
| `home.plan` | `/dashboard/ora` |
| `pipeline.hub` | `/dashboard/pipeline` |
| `pipeline.followups` | `/dashboard/prospects/pipeline` |
| `pipeline.reminders` | `/dashboard/prospects/reminders` |
| `pipeline.board` | `/dashboard/prospects/board` |
| `pipeline.customer-leads` | `/dashboard/prospects/customer-leads` |
| `team.hub` | `/dashboard/team` |
| `team.activation` | `/dashboard/mentorship/team/activation` |
| `team.partners` | `/dashboard/mentorship/partners/my-partners` |
| `team.tree` | `/dashboard/network/tree` |
| `onboarding.activate` | `/dashboard/activate` |
| `campaigns.fund` | `/dashboard/campaigns` |
| `promote.hub` | `/dashboard/promote` |
| `promote.page` | `/dashboard/settings/landing-page` |
| `promote.content` | `/dashboard/resources/ads-contents` |
| `promote.guides` | `/dashboard/resources/prospecting-contents` |
| `wallet.home` | `/dashboard/wallet` |
| `wallet.history` | `/dashboard/wallet/history` |
| `wallet.deposit` | `/dashboard/wallet/deposit` |
| `wallet.compensation` | `/dashboard/compensation` |
| `wallet.billing` | `/dashboard/settings/billing` |
| `products.catalog` | `/dashboard/products` |
| `products.my-store` | `/dashboard/products/my-store` |
| `products.store-orders` | `/dashboard/products/store-orders` |
| `products.resell` | `/dashboard/products/resell` |
| `products.orders` | `/dashboard/products/order-history` |
| `products.guides` | `/dashboard/products/guides` |
| `products.checkout` | `/dashboard/checkout` |
| `learn.hub` | `/dashboard/learn` |
| `learn.progress` | `/dashboard/progress` |
| `learn.goals` | `/dashboard/goals` |
| `learn.courses` | `/dashboard/training/courses` |
| `learn.library` | `/dashboard/training/library` |
| `learn.tutorials` | `/dashboard/training/tutorials` |
| `learn.analytics` | `/dashboard/training/analytics` |
| `learn.coach` | `/dashboard/training/coach` |
| `community.hub` | `/dashboard/community` |
| `community.feed` | `/dashboard/community/feed` |
| `community.events` | `/dashboard/community/events` |
| `community.messages` | `/dashboard/messages` |
| `notifications.center` | `/dashboard/notifications/center` |
| `insights.home` | `/dashboard/insights` |
| `insights.my-business` | `/dashboard/insights/my-business` |
| `insights.downloads` | `/dashboard/insights/downloads` |
| `support.ticket` | `/dashboard/support/ticket` |
| `support.about` | `/dashboard/support/about/app` |
| `settings.profile` | `/dashboard/settings/profiles` |
| `more.hub` | `/dashboard/more` |
| `ora.chat` | `/dashboard/ora` |

The source of truth is `src/modules/ora/domain/Ora.capabilities.js`.

## Executable actions

| Action | What it does | Guardrails |
| --- | --- | --- |
| `schedule_followup` | Logs a dated follow-up commitment | owner match, valid date |
| `advance_stage` | Moves a prospect to a pipeline stage | owner match, valid stage |
| `save_daily_plan` | Saves or edits today's 1-3 focus items | partner scope, max 3 items, dashboard-only links |
| `open_page` | Opens the relevant platform area | capability allowlist |

No money movement, campaign funding, lead purchase, withdrawal, refund, SMS or
email send is executed by Ora. Those remain explicit partner actions on their
existing screens.

## Daily plan

Today's plan is partner-scoped and keyed by the Africa/Lagos calendar day
(`ora-plans`, unique on `partnerId + dateKey`). Ora proposes a plan from live
opportunities; the member approves it before anything is stored.

- `GET /v1/ora/plan` returns `{ dateKey, items, source, savedAt }`.
- `PUT /v1/ora/plan` manually saves/edits `{ items: [{ title, detail?, link? }] }`
  (1-3 items, rate-limited to 30/hour/partner).
- `POST /v1/ora/actions/:id/approve` with a `save_daily_plan` card upserts the
  same day, so repeat approval cannot duplicate a plan.
- The model can reference `opp:plan:today` and provide a JSON array in `draft`;
  unknown fields are stripped, links must be known dashboard pages, and the
  server re-validates everything before saving.

## Live opportunities

`Ora.opportunities.js` turns live state into a bounded list of safe proposals:

- stale or due follow-ups
- hot leads
- at-risk goals
- unread notifications
- next community event
- low wallet balance before SMS
- team pulse for Leader/Ambassador ranks
- today's plan (save or update the 1-3 focus items)

The model may reference only these opportunity IDs. Contact details never enter the prompt; the executor reloads the prospect and re-checks ownership before a stage move or follow-up.

Consent: manual prospects still carry `consentToContact`; survey (`Website`, `Unique Link`), `Admin Push` and personal-page form submissions are opt-in by submission. Customer Leads are store buyers, not pipeline prospects. Ora no longer sends SMS/email, so consent gates the partner's own manual follow-up, not an automated send.

The live context also carries the pipeline stage mix, wallet balance, team size/recent partners, active/pending campaigns, store listings, pending receipts, open store orders, goals, next event, today's saved plan and unread notifications, so answers can quote real numbers.

## Daily usage budget

- `ORA_DAILY_LIMIT` (default `25`, configurable in the API env) caps successful
  chat replies per partner per local day.
- `GET /v1/ora/usage` returns `{ dateKey, limit, used, remaining, resetsAt }`.
- Every `POST /v1/ora/chat` reply includes the same `usage` object, so the chat
  UI can update its progress bar without another request.
- A blocked turn returns `429 ORA_RATE_LIMITED` with `details.usage` and a
  midnight reset hint.
- The counter is in-memory per API process: it resets on restart and is not
  shared across replicas. Move it to Mongo if a hard platform-wide cap is
  required.

## Safety rules

- No auto-send without approval.
- No automated contact without `consentToContact === true`.
- No invented prospect IDs, links, amounts or results.
- Unknown capability/opportunity IDs are dropped.
- Maximum 3 action cards per reply.
- Maximum 20 pending approval actions per partner.
- Approval executes once; repeat approval returns the existing result.
- Every execution/skip writes an audit row (`ora.action.execute`, `ora.action.skip`).
