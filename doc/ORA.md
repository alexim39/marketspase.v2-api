# Ora — business coach + support operator

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
| `pipeline.sessions` | `/dashboard/prospects/bookings` |
| `pipeline.page-leads` | `/dashboard/prospects/personal-list` |
| `team.hub` | `/dashboard/team` |
| `team.activation` | `/dashboard/mentorship/team/activation` |
| `team.partners` | `/dashboard/mentorship/partners/my-partners` |
| `team.tree` | `/dashboard/network/tree` |
| `team.coaching` | `/dashboard/training/coach` |
| `team.cell-meeting` | `/dashboard/mentorship/cell-meeting` |
| `onboarding.activate` | `/dashboard/activate` |
| `campaigns.fund` | `/dashboard/campaigns` |
| `promote.hub` | `/dashboard/promote` |
| `promote.page` | `/dashboard/settings/landing-page` |
| `promote.content` | `/dashboard/resources/ads-contents` |
| `promote.guides` | `/dashboard/resources/prospecting-contents` |
| `promote.outreach` | `/dashboard/promote/outreach` |
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
| `insights.team-reports` | `/dashboard/insights/team-reports` |
| `insights.contact-analytics` | `/dashboard/insights/contact-analytics` |
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
| `send_sms` | Sends an approved SMS through `v1/outreach` economics | owner match, recorded consent, valid Nigerian mobile, wallet balance, per-send rate limits |
| `send_email` | Sends an approved email | owner match, recorded consent, valid email |
| `schedule_followup` | Logs a dated follow-up commitment | owner match, valid date |
| `advance_stage` | Moves a prospect to a pipeline stage | owner match, valid stage |
| `save_daily_plan` | Saves or edits today's 1-3 focus items | partner scope, max 3 items, dashboard-only links |
| `open_page` | Opens the relevant platform area | capability allowlist |

No money movement, campaign funding, lead purchase, withdrawal or refund is executed directly by Ora. Those remain explicit partner actions on their existing screens.

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

The model may reference only these opportunity IDs. Contact details never enter the prompt; the executor reloads the prospect and re-checks ownership and consent.

Consent: manual/contact-list prospects need `consentToContact: true`. Survey-sourced leads (`Website`, `Unique Link`) and `Admin Push` leads are opt-in by submission, including older rows.

The live context also carries the pipeline stage mix, wallet balance, team size/recent partners, active/pending campaigns, store listings, pending receipts, open store orders, goals, next event, today's saved plan and unread notifications, so answers can quote real numbers.

## Safety rules

- No auto-send without approval.
- No automated contact without `consentToContact === true`.
- No invented prospect IDs, links, amounts or results.
- Unknown capability/opportunity IDs are dropped.
- Maximum 3 action cards per reply.
- Maximum 20 pending approval actions per partner.
- Approval executes once; repeat approval returns the existing result.
- Every execution/skip writes an audit row (`ora.action.execute`, `ora.action.skip`).
