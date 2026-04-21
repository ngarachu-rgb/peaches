# Branch Strategy Notes

## Current Decision

For the current rollout phase:

- `inventory` stays **restaurant-level**
- `shift_inventory` stays **branch-derived through `shift_id`**

This is the safest approach for the current app state.

## Why `inventory` stays restaurant-level

Right now `inventory` is functioning as the **finished product master**:

- product name
- selling price
- category

It is not the current source of truth for live shift stock movement.

Based on confirmed operating rules:

- `TSAVO` and `CAFE_LI` share recipes
- `TSAVO` and `CAFE_LI` share selling prices

So there is no immediate reason to split finished product definitions by branch.

## Why `shift_inventory` stays derived through `shift_id`

`shift_inventory` is the live source of truth for shift stock values:

- opening stock
- added today
- closing qty
- sold qty

Every `shift_inventory` row already belongs to a `shift_id`, and `shifts` is now branch-scoped.

That means branch can be derived safely through:

- `shift_inventory.shift_id -> shifts.branch_id`

So adding a separate `branch_id` to `shift_inventory` now would be redundant and add migration risk without clear benefit.

## What this means in practice

### `inventory`
- shared inside `PEACHES_FOOD`
- shared inside `PEACHES_BAR` separately
- used as product master data

### `shift_inventory`
- branch scope comes from the parent shift
- should not be treated as cross-branch shared data

## Risks / legacy notes

Earlier audits showed `inventory` still has some old stock-like columns such as:

- `bbf`
- `added_today`
- `close_qty`
- `sold_qty`
- `shift_id`

Those are legacy schema leftovers and should not be treated as the live stock source of truth.

Current source of truth is:

- `inventory` = finished product master
- `shift_inventory` = shift-level stock movement and snapshot

## When to revisit this decision

Revisit `inventory` branch scoping only if one or more of these become true:

1. `TSAVO` and `CAFE_LI` stop sharing selling prices
2. `TSAVO` and `CAFE_LI` stop sharing finished product definitions
3. one branch sells items the other does not
4. branch-specific menu control becomes necessary

Revisit explicit `branch_id` on `shift_inventory` only if:

1. reporting/performance needs it
2. direct branch filtering on `shift_inventory` becomes necessary without parent joins
3. operational complexity increases enough to justify denormalizing the branch scope

## Current Recommendation

Do **not** migrate `inventory` or `shift_inventory` branch columns yet.

Instead:

1. keep `inventory` restaurant-level
2. keep `shift_inventory` branch-derived through `shift_id`
3. continue branch migration on other operational/financial tables first
