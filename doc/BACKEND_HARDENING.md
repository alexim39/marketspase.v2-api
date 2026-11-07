# Backend hardening contract

This document is the source of truth for the reliability, security and
operational controls added to the API. Keep it in sync with route changes.

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

Covered: withdrawals, deposit init, store checkout, campaign creation, lead
claims, page-lead acceptance, outreach SMS/email and onboarding orders.
The web client adds a key and retries once on a transport failure.

## Money ledger

- Wallet mutations use atomic `findOneAndUpdate` with `balance: { $gte: amount }`.
- Transaction rows carry `balanceBefore` / `balanceAfter` where available.
- Withdrawals are created as `Pending` immediately and reconciled by webhook
  every 10 minutes.
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

## Health

- `GET /health/live` — process liveness only.
- `GET /health` — Mongo readiness (1.5s timeout), Paystack configuration,
  circuit-breaker state and registered provider health.

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
- Legacy auth, product and team writes now validate and replace `req.body`
  through `validateBodyInPlace`, stripping unknown fields before controllers.

## PII at rest

- Bank account numbers and KYC address fields are AES-256-GCM sealed with
  `PII_ENCRYPTION_KEY` (fallback `KYC_HASH_SECRET`, then `JWTTOKENSECRET`).
- `enc:v1:` values are transparently read by the API; legacy plaintext rows
  keep working.
- Run `APPLY=1 npm run migrate:pii` once against a backed-up database to seal
  existing rows. Without `APPLY=1` it is a dry run that only reports counts.

## Environment

See `.env.example` for `TRUST_PROXY_HOPS`, `ACCESS_TOKEN_TTL`,
`REFRESH_TOKEN_TTL_MS`, `MONGO_QUERY_TIMEOUT_MS`, `JSON_BODY_LIMIT` and
`LOG_LEVEL`.
