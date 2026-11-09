# Backend hardening contract

Last verified: 2026-11-09

This document is the source of truth for the reliability, security and
operational controls added to the API. Keep it in sync with route changes.
Deploy order, alert thresholds and incident playbooks live in
[`RUNBOOK.md`](./RUNBOOK.md).

## Error envelope

Every 4xx/5xx response is normalised:

```json
{
  "message": "Human-readable explanation",
  "success": false,
  "code": "MACHINE_CODE",
  "fix": "What the user should do next",
  "requestId": "uuid",
  "retry_after": 30
}
```

- 5xx messages are always generic; `error`/`stack` are stripped even from
  legacy controllers by `safeErrorResponses`.
- `requestId` is echoed in `X-Request-Id` and structured logs.
- `retry_after` appears on 429/503 responses when a wait is known.

## Rate limits

| Surface | Budget |
| --- | --- |
| Login | 30/hour/IP (plus a 10/minute burst guard) |
| Refresh | 30/hour/IP |
| Withdrawal creation | 5/hour/user |
| Listing update | 10/hour/user |
| Deposit init | 10/hour/user |
| Cost-bearing SMS/email send | 20/hour/user |

Config names are per route in the route files; 429s include `Retry-After`
and `retry_after`.

## Idempotency

Money-changing POSTs accept `Idempotency-Key` (8–100 chars). The same key
with the same body replays the original response for 24 hours. The same key
with a different body returns `409 IDEMPOTENCY_KEY_REUSED`. A concurrent
request returns `409 REQUEST_IN_PROGRESS` with `retry_after: 1`.

Covered: withdrawals, deposit init, store checkout, campaign creation and onboarding orders. The retired lead-pool claim/refund, page-lead acceptance and partner bulk-outreach routes are no longer part of this surface.
Legacy `/campaign` create endpoints honour the header when supplied; the v1
flow requires it. The web client adds a key and retries once on a transport
failure.

## Money ledger

- Wallet mutations use atomic `findOneAndUpdate` with `balance: { $gte: amount }`.
- Transaction rows carry `balanceBefore` / `balanceAfter` where available.
- Withdrawals are created as `Pending` immediately and reconciled by webhook
  every 10 minutes.
- Legacy campaign purchases use one transaction for the `$gte` balance debit,
  the debit transaction row and the campaign itself. A failed campaign save
  can no longer leave the wallet short.
- Deposit intents are credited exactly once via an atomic status flip.
- Provider webhook IDs are stored in `providerevents`; replays short-circuit.

## Outbox

Email/SMS/push side effects from lifecycle notifications are written to
`outboxjobs` and delivered by the `outbox-delivery` sweep every 20 seconds.
Rows are claimed atomically (safe across replicas), retried with exponential
backoff and marked `failed` after five attempts for inspection.

## Multi-replica safety

- Auth, withdrawal, listing, deposit-init and cost-bearing send budgets use
  Mongo-backed counters (`ratelimitcounters`) in addition to the in-memory
  burst guard.
- Every cron sweep acquires a Mongo lease (`joblocks`); a second replica skips
  the tick. Crashed leases expire after the configured TTL.
- The outbox uses a separate atomic row claim, so delivery still runs safely
  even while the cron lease is held by another sweep.
- Set `TRUST_PROXY_HOPS` correctly in production so all per-IP budgets see the
  real client address.

## Recycle bin

- `GET /v1/admin/recycle-bin/:entity` lists soft-deleted records for
  `prospects`, `bookings`, `goals`, `kits`, `tutorials`, `events`,
  `community-posts`, `teams` and `subscriptions`.
- `POST /v1/admin/recycle-bin/:entity/:id/restore` clears `deletedAt`.
- Both routes require an admin session and write a `content.restore` audit row.
- Search, limit and skip are supported; responses include the standard `meta`.

## Catalog pagination and search

- `GET /v1/stores` is cursor-paginated: read `meta.nextCursor` and send it back
  as `?cursor=`. The cursor is opaque and ordered by `updatedAt` + `_id` so new
  stores cannot shift a page.
- Store rows are filtered in one aggregation to published stores that have at
  least one published product, then trimmed to `limit + 1` for `hasMore`.
- `GET /products/getAll?q=` searches product name, short and full description,
  category and SKU. Zero-result product searches are logged to `searchmisses`
  (90-day TTL) for catalogue planning.

## Public forms

- Contact: `POST /v1/contact/submit`, `POST /v1/contact/pre-approach`.
- Surveys: `POST /v1/survey/submit` (partner surveys and the admin partner-survey desk are retired).
- Tickets: `POST /v1/tickets` and `POST /v1/tickets/submit`.
- Newsletter: `POST /v1/email-subscription/subscribe` plus the tokenised
  `GET /v1/email-subscription/confirm/:token` and `/unsubscribe/:token` links.
- All public POSTs are IP-throttled and whitelist fields; unknown and
  server-owned fields are stripped before controllers.
- The unauthenticated subscription delete-by-id route is retired. Admin
  deletion is role-gated under `/v1/admin/subscriptions`.
- Legacy `/emailSubscription/subscribe|confirm|unsubscribe` paths now 307/302
  redirect to v1 so links already sent by email keep working. Remove the
  redirect shim once `audit:legacy` shows no traffic; the current window ends
  on 2026-11-14.

## Health

- `GET /health/live` — process liveness only.
- `GET /health` — Mongo readiness (1.5s timeout), Paystack configuration,
  circuit-breaker state and registered provider health.
- Startup now binds the port **before** index builds, cron registration and
  seeds. An `EADDRINUSE` or other listen error logs `port_in_use` /
  `server_error`, closes Mongo and exits `1` without starting boot tasks.
- `SIGTERM`/`SIGINT` and fatal process errors share one idempotent shutdown:
  stop accepting connections, close idle sockets, then close Mongo with a 5s
  cap. Cron callbacks catch and log failures so one bad sweep cannot become an
  unhandled rejection.
- Socket timeouts: `KEEP_ALIVE_TIMEOUT_MS` (65s), `HEADERS_TIMEOUT_MS` (66s,
  always at least keep-alive + 1s) and `REQUEST_TIMEOUT_MS` (120s).

## Database

- `MONGO_QUERY_TIMEOUT_MS` (default 2000) is applied globally to request-path
  reads, writes and aggregations. Slow queries return `503 SLOW_QUERY` with a
  clear next step.
- Soft delete uses `deletedAt`; business records are never hard-deleted except
  legal erasure and dependent join rows. Covered: prospects, bookings, goals,
  kits, tutorials, events, community posts, teams and email subscriptions.
- Pass `{ withDeleted: true }` on an admin restore/reconciliation query to
  include soft-deleted rows.
- Legacy requests are tagged `legacy: true` in structured logs so dead routes
  can be measured before removal.
- Legacy product, team, booking, partner-profile, prospect, campaign and
  campaign-allocation writes validate and replace `req.body` through
  `validateBodyInPlace`, stripping unknown fields before controllers.
- Retired legacy mounts: `/auth` (use `/v1/auth`), campaign create endpoints
  (use `/v1/campaigns`), `/contact`, `/survey`, `/ticket`, `/emailSubscription`
  (use the `/v1` public forms; `/emailSubscription/*` keeps temporary redirects
  for already-sent email links), legacy email/SMS inbox reads (use v1 message
  reads), booking email-list exports, partner public-search/username lookup and
  individual partner social-link writes (use `/partners/landing-page`). Partner
  bulk SMS/email outreach, `/emails`, `/sms`, cell meetings, coaching notes,
  team reports, contact lists and page-lead desks are retired.

- Legacy email/SMS sends, inbox reads and campaign creation are retired in
  favour of their `/v1` slices. Partner bulk outreach is retired; transactional
  notifications still use the shared outbox and notification senders.
- Run `npm run audit:legacy -- <jsonl-log>` (or pipe structured logs) to see
  request counts per normalised legacy path. The report only counts
  `http_request` rows with `legacy: true`; use it to prove a route is unused
  before removing it. `--since=YYYY-MM-DD` narrows the window.

## PII at rest

- Bank account numbers, KYC address fields, partner address fields and
  date-of-birth values are AES-256-GCM sealed.
- New values carry a key id: `enc:v2:<keyId>:<iv>:<tag>:<ciphertext>`.
  Legacy `enc:v1:` values remain readable and are re-wrapped by the migration.
- Key material comes from `PII_ENCRYPTION_KEY` by default. For rotation, set
  `PII_ENCRYPTION_KEYS` to a JSON map of key id → secret and
  `PII_ACTIVE_KEY_ID` to the key used for new writes.
- Partner address/DOB getters open on documents and a find hook opens lean
  results used by analytics and campaign matching.
- `npm run migrate:pii` seals plaintext rows **and** re-wraps values that are
  not using the active key. Without `APPLY=1` it is a dry run that only reports
  counts; `activeKeyId`, `errorCount` and per-collection counts are printed.
- Deploy the API code before applying the migration: the new DOB field reads
  both legacy dates and sealed strings, while the old schema cannot read sealed
  values.

### Key rotation

1. Add the new secret to `PII_ENCRYPTION_KEYS` and keep the old key id there.
   If existing rows were sealed before the keyring, their key id is `default`;
   either add `"default": "<old PII_ENCRYPTION_KEY value>"` or keep
   `PII_ENCRYPTION_KEY` set. The keyring auto-adds the env-derived `default`
   key so the first rotation can read those rows.
2. Set `PII_ACTIVE_KEY_ID` to the new id and deploy the API.
3. Run `npm run migrate:pii` (dry run), confirm counts, then
   `APPLY=1 npm run migrate:pii`.
4. Rerun the dry run and expect all counts and `errorCount` to be `0`.
5. After the backup/retention window, remove the old key id from
   `PII_ENCRYPTION_KEYS`.

Removing a key before the re-wrap finishes makes those values unreadable;
`rewrap` throws with the missing key id instead of silently dropping data.

## Environment

See `.env.example` for `TRUST_PROXY_HOPS`, `ACCESS_TOKEN_TTL`,
`REFRESH_TOKEN_TTL_MS`, `MONGO_QUERY_TIMEOUT_MS`, `JSON_BODY_LIMIT`,
`LOG_LEVEL`, `PII_ENCRYPTION_KEYS`, `PII_ACTIVE_KEY_ID`,
`KEEP_ALIVE_TIMEOUT_MS`, `HEADERS_TIMEOUT_MS` and `REQUEST_TIMEOUT_MS`.
