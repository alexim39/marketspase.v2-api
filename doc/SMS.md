# SMS Center

Partner-funded direct SMS for prospects and direct downline partners. This is
separate from the admin Broadcast campaign, Ora follow-up SMS, and the
mentor-handoff welcome message; those flows keep their existing sender,
funding and preferences.

## Product rules

- **Audience:** the signed-in partner's own prospects plus partners whose
  `partnerOf` is the signed-in partner. There is no arbitrary phone-number
  sending.
- **Consent:** prospects must have `consentToContact: true`. Partners are
  excluded when `mentorContactPreference` is `prefer_not_now` or their
  notification receive setting is `off`.
- **Opt-outs:** `sms_suppressions` is scoped per sender. A suppressed number is
  removed from recipient lists and rejected during quote/send.
- **Pricing:** ₦10 per page. A page is 160 GSM characters, capped at 3 pages
  (459 characters). Tokens are expanded per recipient first, so a long name can
  make one recipient's message two pages.
- **Wallet:** the sender's existing wallet balance pays the total. Debit,
  campaign creation and recipient rows happen in one request; a send without a
  successful debit is rolled back.
- **Scheduling:** the wallet is debited when the SMS is scheduled. Cancelling
  before it starts refunds every queued recipient. The `sms-campaign-due` job
  (every minute) sends due campaigns.
- **Failures:** a provider rejection marks that recipient `failed` and refunds
  their exact cost (`SMS refund` ledger row). Retry re-debits only the failed
  recipients.

## Tokens

| Token | Value |
| --- | --- |
| `{{first_name}}` | Recipient's first name |
| `{{full_name}}` | Recipient's full name |
| `{{my_name}}` | Sender's display name |
| `{{store_link}}` | Sender's store URL |
| `{{lead_page}}` | Sender's lead-page URL |

## Data

| Collection | Purpose |
| --- | --- |
| `sms_campaigns` | One row per composed send, including status and totals |
| `sms_recipients` | Per-recipient rendered body, pages, cost and delivery state |
| `sms_templates` | Partner-saved templates; system templates live in code |
| `sms_suppressions` | Per-sender SMS opt-outs |

Campaign statuses: `scheduled`, `sending`, `sent`, `partial`, `failed`,
`cancelled`. Recipient statuses: `queued`, `sending`, `sent`, `failed`,
`cancelled`.

Wallet ledger rows use `transactionType: SMS` for the charge and
`transactionType: SMS refund` for refunds. `totalCost` is the campaign's
original charge; `refundedAmount` is the money returned. A retry's re-debit is
a separate ledger row and does not inflate `totalCost`, so the net cost stays
`totalCost - refundedAmount`.

## API

All routes require an authenticated partner. The partner id always comes from
the session (`req.auth.partnerId`), never from the request body.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/sms/recipients?type=prospects\|partners&q=` | Eligible and skipped contacts with reasons |
| `POST` | `/v1/sms/suggest` | Ora copy suggestions for one selected contact |
| `POST` | `/v1/sms/quote` | Authoritative pages, cost, shortfall and previews |
| `POST` | `/v1/sms/send` | Charge the wallet, create the campaign, queue/schedule it |
| `GET` | `/v1/sms/campaigns?limit=&skip=&status=` | Sender-scoped history |
| `GET` | `/v1/sms/campaigns/:id` | Campaign + per-recipient delivery detail |
| `POST` | `/v1/sms/campaigns/:id/cancel` | Cancel a scheduled send and refund all recipients |
| `POST` | `/v1/sms/campaigns/:id/retry` | Re-debit and re-queue failed recipients |
| `GET/POST/PATCH/DELETE` | `/v1/sms/templates` | Partner templates; system templates are read-only |
| `GET/POST/DELETE` | `/v1/sms/suppressions` | Per-sender opt-outs |

### Send example

```json
{
  "idempotencyKey": "4c0f8e7a-2e9e-4f38-9f8d-1e7e9d7a2b11",
  "recipients": [
    { "type": "prospect", "id": "507f1f77bcf86cd799439011" },
    { "type": "partner", "id": "507f1f77bcf86cd799439021" }
  ],
  "body": "Hi {{first_name}}, this is {{my_name}}. Is now still a good time?",
  "scheduledAt": "2026-12-01T09:00:00.000Z"
}
```

`idempotencyKey` is unique per sender. A replayed key returns the existing
campaign instead of charging again.

### Quote response highlights

```json
{
  "pages": 1,
  "recipients": 2,
  "ineligible": [{ "id": "…", "name": "Rita", "reason": "Opted out of SMS" }],
  "cost": 20,
  "pricePerPage": 10,
  "walletBalance": 51776.1,
  "canSend": true,
  "shortfall": 0,
  "previews": [
    { "name": "Mercy Lebo", "phoneMasked": "•••• 6348", "pages": 1, "cost": 10, "body": "Hi Mercy, this is Ada Obi…" }
  ]
}
```

## Operations

- The provider is configured through `env.sms` (`SMS_PROVIDER`,
  `SMS_HTTP_*`, `BULKSMS_API_TOKEN`, `BULKSMS_SENDER_ID`). When disabled,
  `LogSmsSender` logs instead of spending credit; the campaign worker treats a
  logged send as a failure so a staging/test environment never reports a fake
  delivery as sent.
- `sms-campaign-due` is registered in `src/jobs/schedule.js` and in the
  automation health cadence (`EXPECTED_EVERY_MIN`). It sends campaigns whose
  `scheduledAt` is due and recovers campaigns left in `sending` for more than
  two hours (for example after a process restart).
- `Sms.service.js` accepts injected stores, sender, logger and enqueue
  function. Tests use an in-memory fake store and fake sender; live provider
  calls are never made by the test suite.

## Tests

```bash
node --test src/modules/sms/application/Sms.service.test.js
node --test src/modules/sms/interface/Sms.routes.test.js
```

Covered: page pricing after personalisation, consent and opt-outs, direct-team
scope, wallet debit and ledger, insufficient balance, idempotency, provider
failure refunds, retry re-debit, scheduling, cancellation refunds, due-job
processing, Ora suggestions, route auth/validation.

## UI

`/dashboard/messages/sms` (`SmsCenterComponent`) has Compose, History,
Templates and Opt-outs tabs. It calls `/quote` on a debounce so the displayed
cost reflects the rendered message, shows skipped recipients with the reason,
and offers an "as sent" preview. Entry points:

- Messages header: **SMS**
- Prospect detail: **Send SMS** (`?prospect=<id>`)
- Partner dossier: **Send SMS** (`?partner=<id>`)
- Sidebar: **SMS Center**
