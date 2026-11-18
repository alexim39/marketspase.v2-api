# Admin communications: Broadcast and Ora monitor

## Broadcast audiences

`POST /v1/admin/broadcast/campaigns` and `/campaigns/estimate` accept an
additive `audience` object:

```json
{
  "mode": "all",
  "source": "platform",
  "accountState": "all"
}
```

- `source: "platform"` (default) resolves from `partners`.
- `source: "customers"` resolves from `store_customer_leads` and only includes
  `consentToContact: true` rows.
- `accountState: "member" | "partner"` filters platform accounts by activation
  state. Missing legacy state counts as partner.
- Customer audiences are all-consented only. Customer campaigns support email
  and SMS; in-app is forced off because customers have no platform inbox.
- Existing campaign payloads without `source`/`accountState` retain the old
  platform/all behaviour.

`GET /v1/admin/broadcast?channel=sms|email|inApp&source=platform|customers&accountState=member|partner`
filters history for the SMS history view and per-audience reporting.

Campaign stats include `source` and `accountState`; per-channel sent/failed
counts remain in `stats`.

## Ora-assisted drafting

`POST /v1/admin/broadcast/draft` is admin-only and returns:

```json
{ "subject": "...", "body": "...", "smsBody": "...", "provider": "ora" }
```

It uses the existing DeepSeek client with an admin prompt. It does not create
partner Ora conversations, consume partner usage limits, or queue a campaign.
The admin reviews/edits and explicitly queues afterwards. The action is
audited as `broadcast.draft`.

## Ora monitor

Admin-only routes under `/v1/admin/ora`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/overview?days=` | KPIs, topics, daily volume, action counts |
| GET | `/conversations?q=&accountState=&flagged=&hidden=&from=&to=&limit=&skip=` | Paginated conversation monitor |
| GET | `/conversations/:id` | Transcript, partner, actions, events and plan |
| POST | `/conversations/:id/flag` | Flag/unflag with reason |
| POST | `/conversations/:id/notes` | Internal admin note |
| POST | `/conversations/:id/hide` | Hide/restore from partner view |
| GET | `/actions?status=&partnerId=&limit=&skip=` | Cross-user Ora actions |
| GET | `/export` | CSV metadata/transcript summary |

Access is `requireAuth` + `requireRole('admin')`. Reads and moderation actions
are audited (`ora.view`, `ora.flag`, `ora.note`, `ora.hide`, `ora.restore`,
`ora.export`).

### Moderation fields

`Ora-conversation` now carries optional `moderation`:

- `flagged`, `flagReason`, `flaggedAt`, `flaggedBy`
- `hidden`, `hiddenAt`, `hiddenBy`, `hiddenReason`
- `notes[]`

Hiding removes the conversation from the partner's Ora list/detail but keeps it
available to admins. No hard delete is performed by the monitor.

### UI

- Broadcast: Communications -> Broadcast
- Ora monitor: Communications -> Ora monitor
- The monitor includes KPIs, filters, transcript reading, actions/events/plan,
  flag/hide controls, internal notes and CSV export.
