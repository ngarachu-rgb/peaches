# Day 3 Dry Run Log

Last updated: 2026-04-16

Use this file to record each dry run before moving to Day 4.

Status key:
- `[ ]` Not started
- `[~]` In progress
- `[x]` Passed
- `[!]` Failed / mismatch found

## Dry Run A: Normal Shift

Status: `[x]`

Scenario:
- Kitchen production entered
- Sales closing entered for all items
- Small expense recorded
- Shift closed
- Next shift opened

Input notes:
- Date:
- Shift id before close:
- Products produced:
- Products sold / closings entered:
- Expense lines entered:
- Debt lines entered: none expected

Expected results:
- Shift closes without validation/runtime errors
- Closing stock becomes next opening stock
- M-Pesa closing becomes next shift opening
- New shift M-Pesa closing starts blank
- New shift withdrawals start blank
- Expense detail row saves and matches shift summary
- Variance shown on finance page matches shift report

Actual results:
- Close success: Yes
- Closing stock carry-forward: Correct
- M-Pesa carry-forward: Correct
- Expense detail saved: Yes
- Variance consistent: Yes

Mismatch / bug notes:
- 

Go / no-go for this run:
- [x] Pass
- [ ] Needs fix

## Dry Run B: Debts Scenario

Status: `[x]`

Scenario:
- Kitchen production entered
- Sales closing entered
- Debt given entered
- Debt paid entered
- Shift closed
- Reports checked

Input notes:
- Date:
- Shift id before close:
- Debt given lines:
- Debt paid lines:
- Other expenses:

Expected results:
- Debt line items save with client name, phone, amount, notes
- Shift totals match debt detail row sums
- Reports show consistent totals

Actual results:
- Debt given saved: Yes
- Debt paid saved: Yes
- Totals matched: Yes
- Reports consistent: Yes

Mismatch / bug notes:
- 

Go / no-go for this run:
- [x] Pass
- [ ] Needs fix

## Dry Run C: Stock-Heavy Scenario

Status: `[~]`

Scenario:
- Multiple production items posted
- Stock receipt posted
- Sales closing entered
- Shift expense entered
- Shift closed
- Carry-forward and reports checked

Input notes:
- Date:
- Shift id before close:
- Items produced:
- Stock receipts:
- Expenses:

Expected results:
- Multiple production postings save correctly
- No accidental duplicate reverse dispatch
- Shift closes cleanly
- Carry-forward remains correct
- Reports still load without mismatch

Actual results:
- Production postings saved:
- Stock receipt impact reviewed:
- Carry-forward correct:
- Reports consistent:

Mismatch / bug notes:
- 

Go / no-go for this run:
- [ ] Pass
- [ ] Needs fix

## Manual Reconciliation Summary

- Sales vs report totals:
- Cash vs reconciliation:
- M-Pesa vs reconciliation:
- Debts vs detail rows:
- Expenses vs detail rows:
- Closing stock vs next opening stock:

## Open Issues Found During Day 3

- 
