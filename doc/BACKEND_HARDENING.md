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

## Health

- `GET /health/live` — process liveness only.
- `GET /health` — Mongo readiness (1.5s timeout), Paystack configuration,
  circuit-breaker state and registered provider health.

## Database

- `MONGO_QUERY_TIMEOUT_MS` (default 2000) is applied globally to request-path
  reads, writes and aggregations. Slow queries return `503 SLOW_QUERY` with a
  clear next step.
- Soft delete uses `deletedAt`; business records are never hard-deleted except
  legal erasure and dependent join rows.

## Environment

See `.env.example` for `TRUST_PROXY_HOPS`, `ACCESS_TOKEN_TTL`,
`REFRESH_TOKEN_TTL_MS`, `MONGO_QUERY_TIMEOUT_MS`, `JSON_BODY_LIMIT` and
`LOG_LEVEL`.
