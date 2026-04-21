# Trial Readiness Checklist

Last updated: 2026-04-15

Status key:
- `[ ]` Not started
- `[~]` In progress
- `[x]` Completed
- `[!]` Blocked / needs decision

## Day 1 Database Prep

- [x] Confirm live schema for active tables
  Owner: User + Codex
  Notes:
  - Tables to verify: `profiles`, `shifts`, `shift_inventory`, `inventory`, `main_store`, `recipes`, `stock_receipts`, `expenses`, `debts`
  - 2026-04-15: Started Day 1. Preparing SQL audit script for live schema verification.
  - 2026-04-16: Verified all active core tables exist in Supabase.

- [x] Finalize `expenses` schema for shift expense line items
  Owner: User + Codex
  Notes:
  - Required target fields: `shift_id`, `description`, `qty`, `unit_cost`, `amount`, `notes`, `created_by`, `created_at`
  - 2026-04-16: Verified fields now exist in the live schema.

- [x] Finalize `debts` schema for detailed debt tracking
  Owner: User + Codex
  Notes:
  - Required target fields: `shift_id`, `transaction_type`, `client_name`, `phone`, `amount`, `notes`, `created_by`, `created_at`
  - 2026-04-16: Verified fields now exist in the live schema.

- [x] Verify foreign keys and id types
  Owner: User + Codex
  Notes:
  - Check `shift_inventory.shift_id`
  - Check `expenses.shift_id`
  - Check `debts.shift_id`
  - 2026-04-16: Verified `debts.shift_id -> shifts.id`, `expenses.shift_id -> shifts.id`, `shift_inventory.shift_id -> shifts.id`.

- [x] Clean legacy data issues
  Owner: User + Codex
  Notes:
  - Duplicate open shifts
  - Orphaned shift inventory rows
  - Old expense/debt rows with bad references
  - 2026-04-16: No duplicate open shifts found.
  - 2026-04-16: No orphaned `shift_inventory`, `expenses`, or `debts` rows found.

- [x] Review RLS / policies for trial mode
  Owner: User + Codex
  Notes:
  - Confirm all active workflows can read/write without hidden permission errors
  - 2026-04-16: Replaced dev-open policies with single-restaurant RLS policies across active tables.

- [ ] Export a backup snapshot before wider testing
  Owner: User
  Notes:
  - Keep a point-in-time backup before major schema cleanup

### Day 1 Outcome

- [x] Day 1 database prep complete enough to proceed to Day 2 app hardening
  Notes:
  - `sales_reports` confirmed legacy / unused for the current app flow.
  - Core finance tables now align with the app more closely.
  - Deferred cleanup remains for:
    - `profiles.password_plain`
    - overlapping legacy columns in `shifts`
    - duplicate stock fields in `main_store`
    - shift-like fields living in `inventory`

## Day 2 App Hardening

- [x] Enforce explicit closing stock entry for every sales row
  Owner: Codex
  Notes:
  - Blank closing qty must block shift close
  - `0` must be accepted as an explicit value
  - 2026-04-16: Shift close now requires an explicit closing entry for every sales row.
  - 2026-04-16: Entered `0` is preserved and treated as valid instead of appearing blank after rerenders.

- [x] Unify variance logic everywhere
  Owner: Codex
  Notes:
  - Same formula in live reconciliation, saved shift totals, shift reports, and detail view
  - 2026-04-16: Shift reports and detail view now use the same variance helper/sign as live reconciliation and saved shifts.

- [x] Detect duplicate open shifts and fail loudly
  Owner: Codex
  Notes:
  - Do not silently proceed when more than one open shift exists
  - 2026-04-16: App now checks for multiple open shifts before loading or closing a shift and throws a readable error if duplicates exist.

- [x] Review partial-write risk in shift close flow
  Owner: Codex
  Notes:
  - Improve ordered save logic and reduce inconsistent close outcomes
  - 2026-04-16: Added compensating rollback in shift close flow to clean up a newly created next shift and restore the current shift if late-stage close steps fail.

- [x] Harden reverse dispatch duplication protection
  Owner: Codex
  Notes:
  - Current guard is mostly client-side
  - 2026-04-16: Added per shift/product/qty in-flight locking and a short-lived session duplicate guard to reduce accidental reposts.

- [x] Confirm detailed expense/debt rows persist correctly
  Notes: Verified against shift `8ba1090a-736e-4202-a4ab-821f8ab0f4d5`; expense and debt line items saved with `shift_id`, names, phone, amounts, notes, and summary totals matched detail-row sums exactly.
  Owner: User + Codex
  Notes:
  - Totals in reconciliation must come from detail rows only
  - 2026-04-16: Fixed expense line payload so detail rows now include computed `amount`.
  - 2026-04-16: Added `sql/day2_finance_persistence_check.sql` for live verification after a test shift close.

- [x] Review report labels for estimated values
  Owner: Codex
  Notes:
  - Financial report UI now labels estimated reports explicitly:
    - `Raw Consumption Estimate`
    - `Kitchen vs Sales Comparison`
    - `Estimated Profit / Loss`
  - Preview notes now explain that these are estimates/comparisons rather than full reconciled accounting reports.

- [ ] Keep automated staff creation paused unless fully stable
  Owner: User + Codex
  Notes:
  - Use manual Auth + `profiles` setup during trial if needed
  - 2026-04-16: Keep staff creation manual during dry runs and early trial use.

### Day 2 Outcome

- [x] Day 2 app hardening complete enough to proceed to Day 3 dry runs
  Notes:
  - Shift close now requires explicit stock entry, including `0`.
  - Variance logic is consistent across finance and reports.
  - Duplicate open shifts now fail loudly.
  - Next-shift M-Pesa carry-forward and reset behavior was re-verified after fixing finance handoff state.
  - Expense and debt detail persistence matched shift summary totals in live verification.

## Day 3 Dry Runs

- [x] Dry Run A: normal shift
  Owner: User
  Notes:
  - Production
  - Sales closing
  - Small expense
  - Shift close
  - Carry-forward check
  - 2026-04-16: Day 3 started. Use `DAY3_DRY_RUN_LOG.md` to record expected vs actual results.
  - 2026-04-16: Completed successfully; user confirmed expected shift close, carry-forward, and report behavior.

- [x] Dry Run B: debts scenario
  Owner: User
  Notes:
  - Debt given
  - Debt paid
  - Shift close
  - Totals and report check
  - 2026-04-16: Completed successfully; debt entry, debt reports, and shift totals behaved as expected.

- [~] Dry Run C: stock-heavy scenario
  Owner: User
  Notes:
  - Multiple production items
  - Stock receipt
  - Expenses
  - Shift close
  - Carry-forward and reports
  - 2026-04-16: Kitchen production now pre-validates all raw material deductions before touching store stock, and fails with clearer insufficient-stock / invalid-recipe messages.

- [ ] Manual reconciliation against expected results
  Owner: User
  Notes:
  - Compare sales, cash, M-Pesa, debts, expenses, closing stock, next opening stock

## Day 4 Supervised Live Trial

- [ ] Choose one branch / one controlled setup
  Owner: User
  Notes:
  - One cashier
  - One manager supervising

- [ ] Run one real supervised trial day
  Owner: User
  Notes:
  - Keep manual backup records in parallel

- [ ] Reconcile app output with manual records
  Owner: User
  Notes:
  - Sales
  - Cash
  - M-Pesa
  - Debts
  - Expenses
  - Closing stock
  - Next opening stock

- [ ] Record user pain points and defects
  Owner: User + Codex
  Notes:
  - Capture workflow confusion, button issues, missing validations, report mismatches

## Go / No-Go

- [ ] Shift close works end-to-end without schema/runtime errors
- [ ] Closing stock carry-forward is correct
- [ ] Cash and M-Pesa carry-forward are correct
- [ ] Expense/debt details save correctly
- [ ] Reports match saved shift-close values
- [ ] No major console/runtime errors during normal flow
- [ ] Trial users can log in reliably
- [ ] Permissions are safe enough for trial users
- [ ] At least 3 dry runs completed
- [ ] At least 1 supervised live trial day completed

## Current Notes

- 2026-04-15: Finance page upgraded to line-item expense/debt entry with totals auto-calculated into reconciliation.
- 2026-04-15: Expense/debt persistence currently uses compatibility fallbacks while database schema is being stabilized.
- 2026-04-15: Automated staff creation is still not trial-ready; manual setup is safer for now.
