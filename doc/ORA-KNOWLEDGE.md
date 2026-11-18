# Ora knowledge, coaching and handoff

Ora is the MarketSpase AI business coach and platform guide. The prompt is built
from three sources:

1. **`domain/Ora.knowledge.js`** — canonical platform facts, approved objection
   handling, response style and handoff rules.
2. **`application/Ora.context.js`** — the member's live journey, activation,
   KYC, sponsor, training and direct-team activation status.
3. **`domain/Ora.capabilities.js`** — the pages and safe actions Ora may prepare.

## Canonical facts

- MarketSpase is an AI-based, product-backed online business. The platform brings
  the interest; Ora plans and prepares; the member approves the next move.
- A fuller alternative is available for prospects who ask for more detail:
  MarketSpase is a digital network marketing platform powered by AI that helps
  people turn time already spent online into a real, product-backed business.
  It skips the chasing: no cold calls, no "bring 2 people to grow", no chasing
  friends, no scripts and no forced inventory or repeat buying to earn. Ora
  plans the work, prepares the busywork and operates after approval; the member
  stays the CEO.
- Creating an account is free. Email verification lasts 24 hours.
- Activation is optional: ₦38,000 for the MarketSpase Signature Clothing Set,
  paid from the wallet and shipped. KYC is required. Activation unlocks
  campaigns, resale, bonuses, the store and commission eligibility. A refund
  reverses activation back to member status.
- A new account is a member. Activation makes the member a partner. Referred
  members keep their sponsor; unsponsored members enter fair allocation.
- Daily rhythm: up to three priorities and one momentum item; approve, edit or
  skip. Human conversations, training and order fulfilment remain the member's
  work.
- Training: IPO, QSG, SMO and Leadership/Self Development.
- Earnings: resale margin, store sales, activation commissions, product-order
  commissions, mentor bonus and rank depth. Signup alone, recruiting alone,
  training alone, campaign spend, deposits and withdrawals do not pay.
- Compliance: no income guarantees, no pressure, opt-in contact only, and no
  send without approval.

Money values (starter price, mentor bonus and store fee) come from live
configuration, not duplicated copy.

## Live context added for Ora

- `accountState`, `emailVerified`, `kycStatus`, `activatedAt`
- latest activation order and queue status
- sponsor/mentor and mentor-contact preference/consent
- training milestones and next-rank gaps
- direct-team activation: activated, still members, stuck over 7 days, inactive,
  and a bounded recent list
- derived `journeyStage`: new member, member, KYC pending/rejected,
  pre-activation, partner, builder, leader or ambassador

An unactivated account is never described as a Partner.

## Response contract

- Answer first; no preamble.
- Simple question: 1–3 short sentences, under 60 words.
- Onboarding/coaching: 3–5 short sentences, under 100 words, one question.
- Full explanation only on request: at most 160 words.
- One question or one next step, never both.
- Quote only the context that answers the question.
- Sound like a professional human agent; never claim to be human.
- For money questions, distinguish a displayed price from money that left the
  wallet. Never say "it is not a charge" without ledger evidence.

## Human handoff

`support.handoff` is an approval action with target `mentor` or `support`.

- Mentor: requires a sponsor and consent for external channels. External consent
  missing falls back to in-app contact. `prefer_not_now` routes to support.
- Support: creates a ticket through the existing support-ticketing module.
- Activation, KYC and payment disputes always route to support.
- Handoffs are audited, consent-gated and never claimed as complete before the
  member approves.

## Usage window

Each partner gets 25 Ora messages per 24-hour window. The window starts with the
first counted message and is stored in MongoDB (`ora_usage_windows`), so page
reloads, new browser sessions and API restarts do not reset the count. Failed
provider calls release their reserved slot. The UI shows `used / 25 messages in
24h` and the reset time when the limit is reached.
