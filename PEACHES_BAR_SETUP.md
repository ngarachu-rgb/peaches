# Peaches Bar Setup

This setup pack prepares `PEACHES_BAR` as its own working restaurant entity with two branches in the same app.

## Current Structure

- `restaurant_code`: `PEACHES_BAR`
- branch codes:
  - `PEACHES_BAR`
  - `CAFE_LI_BAR`
- recommended shift system:
  - `PEACHES_BAR` = `1` (`FULL`)
  - `CAFE_LI_BAR` = `1` (`FULL`)

## What Is Already Ready

- separate restaurant record exists
- separate branch record exists
- branch-aware permissions exist
- branch-aware stock, receipts, expenses, debts, and transfers already work
- branch switcher only works within the current restaurant

## Recommended Users

- `esther`
  - role: `manager`
  - default branch: `PEACHES_BAR`
  - can switch between both bar branches
- `jane`
  - role: `supervisor`
  - fixed branch: `PEACHES_BAR`
- `richy`
  - role: `supervisor`
  - fixed branch: `CAFE_LI_BAR`

## Setup Steps

1. Run the branch setup SQL to ensure both bar branches exist:
   - rename existing generic `BAR` branch to `PEACHES_BAR`
   - create `CAFE_LI_BAR`
2. Create the Auth users in Supabase Auth.
3. Insert or update matching `profiles` rows under:
   - `restaurant_id = PEACHES_BAR`
   - `esther.branch_id = PEACHES_BAR`
   - `jane.branch_id = PEACHES_BAR`
   - `richy.branch_id = CAFE_LI_BAR`
4. Confirm both bar branch shift systems are `1` (`FULL`).
5. Log in as the bar users.
6. Verify isolation:
   - no food-branch data appears
   - stock actions save under the logged-in bar branch
   - receipts save under the logged-in bar branch
   - expenses and debts save under the logged-in bar branch
   - reports only show bar data
   - Esther can switch between both bar branches
   - Jane and Richy remain branch-fixed

## What Still Needs Business Input

- finished products for the bar
- raw materials / ingredients for the bar
- cocktail recipe matrix
- selling prices
- staff assignments

## Recommended Rollout Order

1. run [sql/peaches_bar_multi_branch_setup.sql](/c:/POS%20SYSTEM/sql/peaches_bar_multi_branch_setup.sql:1)
2. onboard `esther`, `jane`, and `richy`
3. verify login and branch isolation
4. add bar finished products
5. add bar raw materials
6. add bar recipes later as needed
7. run one dry run shift in each bar branch
