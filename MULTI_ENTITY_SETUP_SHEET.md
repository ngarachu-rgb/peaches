# Multi-Entity Setup Sheet

Use this document to define the restaurant, branch, and staff structure before implementing multi-entity support.

## 1. Restaurant Records

| Restaurant Code | Restaurant Name | Notes |
| --- | --- | --- |
| `PEACHES_FOOD` | Peaches Food | Parent entity for food operations |
| `PEACHES_BAR` | Peaches Bar | Separate entity for bar operations |

## 2. Branch Records

| Branch Code | Branch Name | Restaurant Code | Notes |
| --- | --- | --- | --- |
| `TSAVO` | Peaches Tsavo | `PEACHES_FOOD` | Food branch |
| `CAFE_LI` | Cafe-Li | `PEACHES_FOOD` | Food branch, shares stock concepts with Tsavo |
| `BAR` | Peaches Bar | `PEACHES_BAR` | Separate bar entity |

## 3. Staff Assignment Sheet

Recommended rule for now:
- one user = one branch

| Full Name | Username | Role | Restaurant Code | Branch Code | Active? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Main admin user | `ngarachu` | `system_admin` or `developer` | `PEACHES_FOOD` | `TSAVO` | `true` | Main setup user |
| Manager 1 | `njeri` | `manager` | `PEACHES_FOOD` | `TSAVO` | `true` | |
| Manager 2 | `richard` | `manager` | `PEACHES_FOOD` | `CAFE_LI` | `true` | |
| Cashier 1 | `...` | `cashier` | `PEACHES_FOOD` | `TSAVO` | `true` | |
| Chef 1 | `...` | `chef` | `PEACHES_FOOD` | `TSAVO` | `true` | |
| Bar Manager | `esther` | `manager` | `PEACHES_BAR` | `BAR` | `true` | |
| Bar Cashier | `...` | `cashier` | `PEACHES_BAR` | `BAR` | `true` | |

## 4. Role Policy Sheet

| Role | Can Manage Staff | Can Manage Raw Materials | Can Manage Recipes | Can Receive Stock | Can Post Kitchen | Can Close Shift | Can View Financial Reports |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `developer` | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `system_admin` | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `manager` | No for now | Yes | Yes | Yes | Yes if needed | Yes | Yes |
| `cashier` | No | No | No | No | No | Yes | Limited shift reports |
| `chef` | No | No | No | No | Yes | No | No |

Recommended note:
- keep `manager` unable to manage staff for now until staff module is stabilized

## 5. Shared vs Separate Master Data

### Shared inside `PEACHES_FOOD`
- recipes
- finished products
- raw material definitions

### Separate for `PEACHES_BAR`
- recipes
- finished products
- raw material definitions

## 6. Transfer Policy Sheet

| From Branch | To Branch | Allowed? | Item Type | Notes |
| --- | --- | --- | --- | --- |
| `TSAVO` | `CAFE_LI` | Yes | Raw materials | Must be recorded as transfer later |
| `CAFE_LI` | `TSAVO` | Yes | Raw materials | Must be recorded as transfer later |
| `TSAVO` | `BAR` | No | Raw materials | Separate restaurant entity |
| `CAFE_LI` | `BAR` | No | Raw materials | Separate restaurant entity |
| `BAR` | `TSAVO` | No | Raw materials | Separate restaurant entity |

## 7. Current Default Setup For Migration

If you migrate gradually, choose one temporary default branch for current live data.

Recommended if current live data is food-side:
- `restaurant_id = PEACHES_FOOD`
- `branch_id = TSAVO`

That lets you backfill current records consistently before splitting further.

## 8. Profiles Target Shape

Each profile should end up with:

| Field | Example |
| --- | --- |
| `id` | auth user uuid |
| `restaurant_id` | `PEACHES_FOOD` |
| `branch_id` | `TSAVO` |
| `username` | `cashier01` |
| `full_name` | `Jane Doe` |
| `role` | `cashier` |
| `is_active` | `true` |

## 9. Setup Decisions To Confirm

Before implementation, fill these in:

- Current live app data belongs to:
  - `PEACHES_FOOD / TSAVO`? `Yes`
- Will one manager ever oversee both `TSAVO` and `CAFE_LI` in the app? `Yes`
- Will one cashier ever log into more than one branch? `No`
- Are food recipes identical between `TSAVO` and `CAFE_LI`? `Yes`
- Are prices identical between `TSAVO` and `CAFE_LI`? `Yes`
- Is `BAR` fully separate for stock and reporting?
  - `Yes`
- Will `TSAVO` and `CAFE_LI` both receive stock directly? `Yes`
- Will raw material transfers happen both ways between `TSAVO` and `CAFE_LI`? `Yes`
- Should bar users ever see food data? `No`
- Should food users ever see bar data? `No`
- Should one user belong to only one branch for now? `Yes`
- Can one chef log into more than one branch? `No`
- Should `manager` remain unable to manage staff for now? `Yes`
- Should only `system_admin` and `developer` manage staff? `Yes`
- Should `cashier` only access sales, finance, shift close, and shift reports? `Yes`
- Should `chef` only access kitchen production? `Yes`

## 10. Next Use

Use this sheet before:
- branch-aware schema migration
- branch-aware staff assignment
- RLS redesign
- transfer workflow implementation
