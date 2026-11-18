# Wallet and non-withdrawable bonuses

The wallet has two buckets:

| Field | Meaning |
| --- | --- |
| `balance` | Total spendable wallet. Used by SMS, campaigns, products and activation purchases. |
| `bonusBalance` | Platform-granted bonus inside `balance`. Never withdrawable. |
| `withdrawableBalance` | `max(0, balance - bonusBalance)`. Returned by `/v1/auth/me` and withdrawal responses. |

## What is non-withdrawable

- Welcome bonus claims and admin-created bonus campaigns (`ClaimBonusUseCase`).
- Admin wallet credits (`POST /v1/admin/wallet/credit`) going forward.
- Any credit explicitly passed to `creditPartnerWallet` with
  `nonWithdrawable: true`.

Withdrawable earnings stay unchanged: Paystack/manual deposits, product and
growth commissions, mentor bonuses, store proceeds and payout refunds.

## Spending and refunds

- `debitPartnerWallet` in `billing/application/Deposit.usecases.js` consumes
  `bonusBalance` first, then cash. This means a member can spend a welcome
  bonus on SMS, campaigns, products or activation without locking their later
  deposit.
- Every debit row stores `bonusAmount` — the portion paid from the bonus
  bucket.
- Refunds restore the same mix. SMS recipients store `bonusCost` per recipient;
  campaigns track `budget.bonusRemaining` as slots are allocated; product and
  activation refunds read the original debit's `bonusAmount`.

## Withdrawals

`CreateWithdrawalUseCase` now:

1. Reads the wallet before touching Paystack.
2. Rejects the request when `balance - bonusBalance < amount`.
3. Uses `debitWithdrawableWallet`, which debits **only cash** and leaves
   `bonusBalance` untouched.
4. Returns `withdrawableBalance` and `bonusBalance` in the result.

The billing page and withdrawal dialog use `withdrawableBalance` and display a
notice when a platform bonus is present. The withdrawal API remains the source
of truth even if an old client sends the total balance.

## Backfill for existing bonuses

Existing welcome-bonus credits predate `bonusBalance`. Run:

```bash
npm run backfill:bonus          # dry-run; prints candidates and totals
APPLY=1 npm run backfill:bonus  # writes bonusBalance
```

The backfill reconstructs unspent bonus from actual `Welcome Bonus`/`Bonus`
credit transactions, subtracts platform spending (excluding withdrawals,
store recoveries and commission reversals), and caps the locked amount at the
current balance. Historical admin credits are intentionally excluded because
their intent is ambiguous; new admin credits are tagged automatically.

## Tests

- `creditPartnerWallet` marks non-withdrawable credits.
- `CreateWithdrawalUseCase` rejects a bonus-only or partly-bonus wallet.
- SMS consumes bonus first and restores it on provider failure/cancel.
- Campaign, product and activation purchase/refund paths carry
  `bonusAmount`.
