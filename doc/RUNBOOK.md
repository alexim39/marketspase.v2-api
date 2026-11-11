# MarketSpase Operations Runbook

Last updated: 2026-11-09

This is the on-call guide for the API in `api/`. It covers deploy order,
health checks, the alert thresholds used by `npm run ops:check`, and the
playbooks for the failures we expect to see first.

The web app has its own CI (`check:legacy-endpoints`) but no runtime alerts;
treat API alerts as the source of truth for platform health.

---

## 1. Service shape

| Item | Value |
| --- | --- |
| Runtime | Node 20+ (CI uses Node 22), Express, MongoDB (replica set for transactions) |
| Entry point | `node server.js` |
| Container | `Dockerfile`, exposes `8080/tcp` |
| Liveness | `GET /health/live` - process is up, no dependencies touched |
| Readiness | `GET /health` - Mongo ping, Paystack configuration, provider breakers, slow-query window |
| Admin automation health | `GET /v1/admin/jobs/health` - admin JWT required |
| Background jobs | `node-cron` in `src/jobs/schedule.js`, one run per cluster via Mongo leases |
| Side effects | Durable outbox in `outboxjobs`, drained every 20 seconds |
| AI coach | Ora (`/v1/ora/*`) with approval-gated actions in `ora-actions` |

Readiness returns `503` when Mongo is down. It never calls Paystack during a
probe; it only reports whether the provider is configured and whether its
circuit breaker is open.

---

## 2. Deploy and rollback

### Pre-deploy checklist

1. API CI is green on the commit being deployed.
2. `.env` contains, at minimum:
   - `MONGODB_URI` or `MONGODB_USERNAME` / `MONGODB_PASSWORD` / `MONGODB_DATABASE`
   - `JWTTOKENSECRET`
   - `PII_ENCRYPTION_KEYS` and `PII_ACTIVE_KEY_ID`
   - `PAYSTACKTOKEN` and the matching public key
   - `BULKSMS_API_TOKEN` and `BULKSMS_SENDER_ID=marketspase`
   - `SMS_PROVIDER=http`
3. A database backup/snapshot exists for any release that changes PII storage.
4. `npm test` passes locally if the change touches a money path, the outbox,
   Ora actions, or encryption.
5. For the single-upline release, `npm run migrate:upline` against production
   reports **0 placement-only** and **0 mismatched** accounts.

### Deploy order

1. **Upline migration first** (single-upline release only):
   ```bash
   npm run migrate:upline              # dry run: inspect placement-only + conflicts
   APPLY=1 npm run migrate:upline      # backfill partnerOf, drop legacy field
   npm run audit:upline                # read-only: expect ok: true
   ```
   The new API does not read `placementParentId`. Running the migration first
   prevents placed members from losing their upline on deploy.
2. **API.** Deploy `api/`, wait for `/health` to report `status: ok`.
3. **PII migration** (only for releases that include encryption changes):
   ```bash
   npm run migrate:pii                 # dry run
   APPLY=1 npm run migrate:pii         # apply
   npm run migrate:pii                 # expect zero pending
   ```
4. **Web/admin** deploy. Its CI guard must pass before the release.
5. Keep the temporary `/emailSubscription/*` redirects for **7 days** after the
   web release, then remove the shim. The current window started
   **2026-11-07**; the earliest safe removal date is **2026-11-14**.
   During that window, capture the API request logs and run:
   ```bash
   npm run audit:legacy -- /var/log/marketspase-api.log --since=2026-11-07
   ```
   Remove the shim only when the report shows no `/emailSubscription/*` rows.
   Also keep web CI's `check:legacy-endpoints` job green.

### Rollback

- API: redeploy the previous image/commit. The outbox and job ledgers are
  forward-compatible; do not roll back the database.
- Web: redeploy the previous build. The API keeps `/v1` compatibility.
- PII: never roll back keys by deleting a key. Keep the previous key in
  `PII_ENCRYPTION_KEYS` and set `PII_ACTIVE_KEY_ID` to the old ID if reads fail;
  ciphertext written with the new key stays readable through the keyring.
- If a bad release is writing money/PII data, stop traffic first
  (`/health/live` is the load-balancer probe), then roll back.

### Production host notes (2026-11-09)

- The API host is the Back4App service at
  `https://marketspasev2api-p3jkxlvy.back4.app`. The previous host is retired. A
  push to GitHub runs CI only; the service must be redeployed from the dashboard
  (or its build hook) after CI is green.
- After redeploy, verify `GET /health` returns `200` and
  `checks.database.status` is `up`.
- Set `EXTRA_CORS_ORIGINS` in the API host environment for the platform, store
  and admin origins:
  `EXTRA_CORS_ORIGINS=https://marketspase.com,https://www.marketspase.com`.
  Verify a preflight to `/v1/auth/signin` returns the matching
  `access-control-allow-origin`.
- Deploy the platform, store and admin builds after the API is healthy. The
  full web CI (`npm run ci`) already builds all three apps.
- The `/emailSubscription/*` redirect removal is calendar-bound: keep it until
  the 7-day audit window ends on **2026-11-14** and `audit:legacy` shows no
  traffic.

---

## 3. Alerts

Run the checker every 5 minutes:

```bash
cd /srv/marketspase/api
npm run ops:check
```

Exit codes: `0` ok, `1` warning, `2` critical. Add `--json` for machine
parsing, `--api-only` when Mongo is not reachable from the monitor, and
`--api-url https://api.example.com` when checking a remote host.

Set `OPS_ALERT_WEBHOOK_URL` to receive a POST with `{text, content, report}`
when anything alerts. The webhook is best-effort and does not change the exit
code.

Example cron (the mail/webhook is the alerting channel):

```cron
*/5 * * * * cd /srv/marketspase/api && /usr/bin/npm run ops:check >> /var/log/marketspase-ops.log 2>&1
```

### Thresholds

All values are defaults; override with the env names in `.env.example`.

| Code | Default trigger | Severity | Meaning |
| --- | --- | --- | --- |
| `HEALTH_UNREACHABLE` | `/health` connection fails | critical | API process or network is down |
| `DB_DOWN` | database check is down | critical | Mongo ping failed or timed out |
| `HEALTH_DEGRADED` | readiness is not `ok` | critical | Non-database readiness failure |
| `OUTBOX_BACKLOG` | pending >= 100 / 500 | warn / critical | Outbox is not draining |
| `OUTBOX_OLDEST` | oldest pending >= 15 / 60 min | warn / critical | A row is stuck behind retries |
| `OUTBOX_FAILED` | failed in 24h >= 1 / 10 | warn / critical | Provider or payload failures |
| `OUTBOX_STUCK` | processing > 5 min >= 1 / 10 | warn / critical | Worker died mid-claim |
| `JOBS_STALE` | jobs without recent success >= 1 / 3 | warn / critical | Cron is not finishing |
| `JOBS_FAILING` | jobs whose last run failed >= 1 / 3 | warn / critical | Repeated sweep errors |
| `JOBS_NEVER_RAN` | any job has no run row | warn | Fresh deploy or scheduler never started |
| `JOB_LOCK_EXPIRED` | expired leases >= 1 / 10 | warn / critical | Crashed worker left leases behind |
| `JOB_LOCK_STUCK` | oldest expired lease >= 30 min | critical | Work is not recovering |
| `PAYSTACK_BREAKER_OPEN` | breaker state `open` | critical | Payment provider failing |
| `PROVIDER_BREAKER_OPEN` | any other breaker `open` | warn | SMS/email/AI provider failing |
| `SLOW_QUERIES` | slow queries in 15 min >= 5 / 25 | warn / critical | Query-path regression |

`/health` also exposes `checks.slowQueries` with `thresholdMs`, `recent`
and `maxMs` (no collection names on the public endpoint). The admin-only
`GET /v1/admin/jobs/health` adds the top collections; long-term history is in
the structured `mongo_slow_query` log lines.

---

## 4. Playbooks

### 4.1 Health endpoint unreachable or failing

1. Check whether the process is running and whether the port is bound.
2. `GET /health/live`:
   - Fails: process/container/network issue. Restart one replica and watch the
     boot logs for `mongo_connect_failed`, `listen_error` or `schedule_jobs_failed`.
   - Succeeds but `/health` returns `503`: go to the database playbook.
3. Confirm the load balancer is probing `/health/live` for liveness and
   `/health` for readiness so a Mongo outage does not cause a restart loop.
4. If the release is the cause, follow the rollback steps in section 2.

### 4.2 Database down or degraded

1. Inspect `/health` -> `checks.database` (`reason: timeout` vs `ping_failed`).
2. Check the Mongo provider status and the connection string (`MONGODB_URI`
   overrides the `MONGODB_*` SRV settings).
3. Look for connection-pool exhaustion: `mongo_connect_failed`,
   `MongoNetworkError`, `MongoServerSelectionError` in the logs.
4. Do not restart every replica at once; keep at least one process serving
   `/health/live` so the platform can recover.
5. After recovery, run `npm run ops:check` and confirm `outbox-delivery` and the
   hourly jobs catch up.

### 4.3 Outbox backlog or failures

The outbox stores email/SMS/push side effects so a provider outage never rolls
back a business transaction.

1. Inspect the shape:
   ```bash
   mongosh "$MONGODB_URI" --eval '
     db.outboxjobs.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray()
   '
   mongosh "$MONGODB_URI" --eval '
     db.outboxjobs.find({ status: { $in: ["pending", "failed"] } })
       .sort({ createdAt: 1 }).limit(5).toArray()
   '
   ```
2. Check `outbox-delivery` health on the admin desk or in `jobruns`. A stale
   lease is usually the cause; see 4.4.
3. If rows are `failed`, read `lastError`. Common causes:
   - SMS: bad token/sender, no credit, or `BSNG-2013` route rejection.
   - Email: SMTP auth/limit; check `EMAIL_*` and provider status.
   - Push: expired subscription; safe to leave failed and let the next
     notification re-create it.
4. Fix the provider/config first. Then replay **only failed rows** after
   checking the provider dashboard for partial sends:
   ```bash
   mongosh "$MONGODB_URI" --eval '
     db.outboxjobs.updateOne(
       { _id: ObjectId("<id>"), status: "failed" },
       { $set: { status: "pending", attempts: 0, nextAttemptAt: new Date(),
                 lastError: null, lockedAt: null } }
     )
   '
   ```
   Never bulk-replay completed rows and never replay an SMS/email row whose
   provider dashboard shows it was delivered; provider sends are not
   idempotent.
5. `processing` rows older than 5 minutes are requeued automatically by
   `claimDue`. If the backlog persists, verify the scheduler is running
   (`JOBS_NEVER_RAN`/`JOBS_STALE`) and that only one replica holds the lease.

### 4.4 Job leases and scheduled jobs

Jobs use one lease per cluster in `joblocks`; each sweep writes its outcome to
`jobruns`.

1. Inspect leases and runs:
   ```bash
   mongosh "$MONGODB_URI" --eval 'db.joblocks.find({}).toArray()'
   mongosh "$MONGODB_URI" --eval '
     db.jobruns.find({}).sort({ lastFinishedAt: -1 }).limit(20).toArray()
   '
   ```
2. Expired leases are reclaimed by the next tick. Delete only leases that are
   already expired and have no corresponding running sweep:
   ```bash
   mongosh "$MONGODB_URI" --eval '
     db.joblocks.deleteMany({ expiresAt: { $lte: new Date() } })
   '
   ```
   **Do not delete an active (future `expiresAt`) lease.** That can run two
   copies of a sweep and duplicate sends or allocations.
3. A local `nodemon` restart around the scheduled minute can skip one tick; the
   next cadence catches up. `compensation-reconcile` is idempotent (it skips
   existing sales and claims each mentor bonus conditionally), so a manual
   catch-up is safe when the ledger looks stale.
4. If one job is stale but others are healthy, inspect its `lastError`, then
   trigger it manually from a staging shell or wait for the next tick.
5. Redis is not used. There is no external queue to flush; Mongo is the queue.

### 4.5 Circuit breaker open

1. `GET /health` -> `checks.providers` lists `state`, `failures`,
   `retryAfter`, `lastErrorAt` and `lastSuccessAt`.
2. The breaker opens after three consecutive provider failures and cools down
   for 60 seconds. One half-open probe is allowed.
3. For `paystack`: do not bypass the breaker and do not fabricate success.
   Confirm Paystack status, key mode (test/live) and webhook reachability.
   Money paths must fail closed.
4. For SMS/email/AI: the provider is failing or timing out. Check the provider
   status page and credentials. Ora falls back to the last reply only for
   `AI_DOWN`/`ORA_PROVIDER_ERROR`; it never sends a message without approval.
5. After the provider recovers, the next request closes the breaker. Confirm
   with `/health` before replaying outbox rows.

### 4.6 Slow queries

1. Find the structured logs:
   ```bash
   grep '"event":"mongo_slow_query"' /var/log/marketspase-api.log | tail -n 50
   ```
   Each line has `collection`, `op`, `durationMs` and `thresholdMs` - no
   filters or PII.
2. Check `/health` -> `checks.slowQueries` for the 15-minute count, then the
   admin-only `GET /v1/admin/jobs/health` (or the logs) for the collections
   contributing most.
3. Run `explain("executionStats")` on the offending query and compare with
   `src/shared/mongo/indexes.js`. `ensureIndexes()` runs at boot; confirm it
   completed and that the expected index exists.
4. Request-path queries are capped by `MONGO_QUERY_TIMEOUT_MS` (default
   2000 ms). Jobs can opt out per query with `skipTimeout` or a larger
   `maxTimeMS`; do not remove the global cap to hide a slow query.
5. If a deploy introduced the regression, roll back; otherwise add the
   missing index before increasing the timeout.

### 4.7 Ora approval failures

Ora never sends SMS or email. Approved actions are limited to opening a page,
scheduling a follow-up, advancing a pipeline stage and saving the daily plan.
The action moves `proposed -> executing -> executed|failed`; approvals are
idempotent and every execution writes an `ora.action.execute` audit event.

1. Find the action:
   ```bash
   mongosh "$MONGODB_URI" --eval '
     db["ora-actions"].find({ status: "failed" }).sort({ createdAt: -1 }).limit(5).toArray()
   '
   ```
2. "not in your pipeline": the stored payload references another partner's
   prospect. Ownership is re-checked on live data at execution.
3. An unknown action type means the stored row predates the retirement of
   Ora SMS/email execution. Skip it; do not replay it.
4. After fixing the cause, re-approve only actions still in `failed` state. An
   `executed` action is final; do not replay it.
5. Transactional SMS provider errors (verification, activation, payout notices)
   still use BulkSMSNigeria: `BSNG-2001` means the sender ID is missing or not
   approved; `401/403` means rotate `BULKSMS_API_TOKEN`; no credit means top up
   the provider account.

### 4.8 Money actions and idempotency

- Withdrawals, deposits, store checkout and campaign purchases require an
  idempotency key. A retry with the same key returns the original result; a
  different key creates a new attempt. Legacy lead-pool claims, page-lead
  acceptance and partner bulk outreach are retired.
- Double-spend protection is enforced inside Mongo transactions with
  conditional balance updates. If a transaction aborts, no ledger row is
  written.
- Check `auditlogs` for `ora.action.execute`, withdrawal, refund and admin
  balance events with before/after balances.
- If a provider callback is delayed, reconcile with
  `payout-reconcile`/`compensation-reconcile` and the provider dashboard.
  Never manually credit a wallet without an audit row.
- Activation commissions auto-release when an activation order is marked
  **Fulfilled**. Product commissions auto-release when a product order is
  marked **Fulfilled**. The hourly `compensation-reconcile` also catches up
  pending activation commissions for orders that were already fulfilled before
  their allocation accrued. Manual **Release** is for exceptions only.
- Sponsor placement: `/join?ref=<partner-username>` sets `partnerOf` when the
  referrer is active, KYC-verified and not suspended. Unknown or inactive
  referrers still create the account, marked `systemOwned: true`. Campaign
  allocation only touches system-owned members (`partnerOf: null`) and sets
  `partnerOf` to the campaign owner plus `placementCampaignId`/`placedAt` for
  history. Converted pipeline leads bind through `lead=<prospectId>` or a
  matching signup email. Never reparent a referred member into a campaign.
  `partnerOf` is the only upline edge for network, team, commissions and
  mentor bonuses; a referred member keeps that upline for life.
- The **MarketSpase root** is virtual (`system-root`), not a partner row. It has
  no login, wallet, KYC, rank or commission entitlement, and must never appear
  in member counts, commission walks, mentor bonuses or payout runs. Network
  tree/org responses expose it as read-only metadata for display only.
- **Single-upline migration:** run `npm run migrate:upline` (dry run) before
  deploying this API, then `APPLY=1 npm run migrate:upline`. It backfills
  `partnerOf` from legacy `placementParentId`, keeps `partnerOf` on conflicts,
  and unsets the legacy field from partners, commission sales and activation
  queue rows. The API no longer reads `placementParentId`.
- **Rank ladder (training/coaching):** Builder = IPO + QSG + 1 personal
  recruit; Leader = SMO + 3 personal recruits + 5 active team members;
  Ambassador = Leadership Development + 5 personal recruits + 3 downline
  Leaders. “Personal recruit” means a direct `partnerOf` child with no
  `placementCampaignId`; system/campaign allocations never qualify a sponsor.
  G8 request letters, office/full-time attestations, DTC-account counts,
  maintenance and nomination approvals are retired.
- **Legacy campaign lead allocation is removed.** Ad campaigns no longer buy
  pool leads at ₦300 with daily/total caps, and no campaign-allocation job or
  ledger runs. Historical `campaigns` records and `/campaign` read/refund
  routes remain only for reconciliation. The separate Buy Prospect pool and its
  ₦250 claim/refund workflow are removed end to end (routes, job and ledger).
- **Customer leads vs pipeline:** store checkout captures the shopper's
  name/email/phone/address in `store_customer_leads` for the partner's
  **Customer leads** page. These are buyers, not cold prospects. The partner
  pipeline remains for prospects, personal-page submissions and referral
  signups; referral signups who have not activated appear in a dedicated
  "Referral signups" section on the pipeline page.
- **Personal lead page:** every partner shares `/lead/<username>` (store app).
  Submissions create a `Prospect` with source `Personal Page` in that partner's
  pipeline. The public store remains `/<username>` and is a separate share link.
- **Product publishing gate:** admin product create/update lives in the admin
  app wizard. A product with a cost breakdown is priced by
  `src/apps/product/domain/ProductPricing.js`; publishing is rejected unless
  media count is 1–5, platform contribution clears the minimum floor
  (`PRODUCT_MIN_PLATFORM_CONTRIBUTION_PCT` and
  `PRODUCT_MIN_PLATFORM_CONTRIBUTION_AMOUNT`), and partner margin clears
  `PRODUCT_MIN_PARTNER_MARGIN_PCT` for resale products. Target values and the
  current `pricing` snapshot are stored on the product. Media uploads use
  Cloudinary `resource_type` image/video with 8 MB image and 50 MB video
  limits; video posters are derived from the first frame.
- **Weekly video:** `weekly_videos` stores the YouTube ID, title,
  description, Monday week start, duration and publish state. The platform
  player has no seek bar; heartbeats credit only actual playback, cap forward
  jumps, pause on hidden tabs and require `WEEKLY_VIDEO_COMPLETION_PERCENT`
  (default 90) before a reflection is accepted. Reflections are one per member
  per video and are hidden from other members until completion. The
  `weekly-video-due` job publishes scheduled videos and sends one keyed in-app
  notification per non-suspended recipient. Set `WEEKLY_VIDEO_NOTIFY_CAP` for
  the fan-out bound. No video files are stored by MarketSpase.
- **Commission rank auto-sync:** journey promotions and demotions mirror into
  `commissionRank` through `progression.promoted` / `progression.demoted`; the
  hourly compensation reconcile repairs drift. Run `npm run migrate:rank-sync`
  (dry run) and then `APPLY=1 npm run migrate:rank-sync` once before enabling
  auto-sync, so legacy rows are tagged: matching ranks become `auto`, mismatches
  stay `admin` overrides for review. Admin overrides require a reason and can
  carry an expiry; every rank change is written to `partner_rank_history` and
  commission entries retain `rankAtAccrual`.
- Mentor bonus timing: the ₦1,000 activation mentor bonus is paid immediately
  when activation is recorded, to the member's `partnerOf` mentor. If the
  mentor is not yet known (system-owned member) or not KYC-qualified yet, the
  row stays `scheduled` and the hourly :15 sweep retries. `MENTOR_BONUS_DAYS`
  is retired and ignored; existing rows with a future `dueAt` still wait for
  that date.

### 4.9 PII encryption

- Format: `enc:v2:<keyId>:<iv>:<tag>:<ciphertext>`; plaintext legacy values
  pass through until the migration seals them.
- Rotate by adding a new key to `PII_ENCRYPTION_KEYS`, setting
  `PII_ACTIVE_KEY_ID`, deploying, then running the dry/apply/verify sequence.
  Generate the new pair with:
  ```bash
  npm run pii:key -- rot1
  ```
  Keep the old `default` key readable. If `PII_ENCRYPTION_KEYS` does not
  contain a `default` entry, the code derives it from
  `PII_ENCRYPTION_KEY` / `KYC_HASH_SECRET` / `JWTTOKENSECRET`. Do **not**
  rotate those secrets until the old PII material is preserved under a
  `default` keyring entry.
- Safe sequence: snapshot the database, add the new key while keeping
  `default`, set the new active id, deploy/restart, run `npm run migrate:pii`
  (dry), then `APPLY=1 npm run migrate:pii`, verify a known address/DOB reads
  correctly, and only then remove the old key.
- An unknown key ID fails closed. Restore the missing key in the keyring; do
  not rewrite ciphertext by hand.
- Legal erasure is a hard delete for the covered records; normal business
  deletes are soft deletes and can be restored from the admin recycle bin.

---

## 5. Routine checks

Daily:

- `/health` returns `ok`.
- `npm run ops:check` is clean.
- `jobruns` shows `outbox-delivery`, `payout-reconcile`, `store-order-expiry`
  and `store-escrow-release` succeeding.
- No unexplained `failed` outbox rows.

Weekly:

- Review `mongo_slow_query` volume and the top collections.
- Review `ora.action.execute` audits for failed consent/ownership attempts.
- Review failed outbox rows and the provider dashboards.
- During the legacy window, run `npm run audit:legacy`.

After every deploy:

- `/health` is `ok`.
- `JOBS_NEVER_RAN` clears within one cadence.
- A test Ora chat returns a reply and at least one approval card; approve an
  `open_page` action (free) rather than a live SMS.

---

## 6. Useful commands

```bash
# API test suite
npm test

# Targeted Ora coverage
node --test src/modules/ora/**/*.test.js

# Operations check
npm run ops:check
npm run ops:check -- --json
npm run ops:check -- --api-only --api-url https://api.example.com

# PII migration
npm run migrate:pii
APPLY=1 npm run migrate:pii

# Single-upline migration + read-only audit
npm run migrate:upline
APPLY=1 npm run migrate:upline
npm run audit:upline

# Legacy endpoint audit (during the 7-day window)
npm run audit:legacy

# Outbox status
mongosh "$MONGODB_URI" --eval '
  db.outboxjobs.aggregate([{ $group: { _id: "$status", n: { $sum: 1 } } }]).toArray()
'

# Job health
mongosh "$MONGODB_URI" --eval '
  db.jobruns.find({}).sort({ lastFinishedAt: -1 }).toArray()
'
```

Escalation: page the API owner for `critical`; `warn` can wait for the next
business hour unless it is trending toward a critical threshold. Record the
timeline, root cause and follow-up actions after every critical incident.
