# Bar Spirit Naming Standard

Use this standard for all spirit stock and spirit-based sales in `PEACHES_BAR`.

## Core Rule

Bottle sizes must always remain separate stock items.

If a brand exists in:
- `750ML`
- `1000ML`

then treat them as different raw/store items and different full-bottle sale items.

Reason:
- different buying prices
- different bottle volumes
- different stock balances
- different full-bottle selling prices

## 1. Raw / Store Item Naming

Always use:

- `Brand + Size`

Examples:
- `Smirnoff Vodka 750ML`
- `Smirnoff Vodka 1000ML`
- `Black & White 750ML`
- `Black & White 1000ML`
- `Captain Morgan Gold 250ML`
- `Captain Morgan Gold 750ML`

## 2. Raw / Store Unit Rule

For spirits:
- `buy_unit = Bottle`
- `store_unit = ML`
- `conversion_factor = actual bottle size`

Examples:
- `Smirnoff Vodka 750ML`
  - buy unit: `Bottle`
  - store unit: `ML`
  - conversion factor: `750`

- `Smirnoff Vodka 1000ML`
  - buy unit: `Bottle`
  - store unit: `ML`
  - conversion factor: `1000`

## 3. Full Bottle Finished Product Naming

Use the same clear size-based naming:

- `Smirnoff Vodka 750ML`
- `Smirnoff Vodka 1000ML`
- `Black & White 750ML`
- `Black & White 1000ML`

These are separate finished products because:
- they are sold as different units
- they may have different sale prices

## 4. Full Bottle Recipe Rule

Each full bottle finished product deducts from its exact matching raw/store item.

Examples:
- `Smirnoff Vodka 750ML` -> raw `Smirnoff Vodka 750ML` = `750 ML`
- `Smirnoff Vodka 1000ML` -> raw `Smirnoff Vodka 1000ML` = `1000 ML`

## 5. Measured Sale Naming

Measured sales should stay clean and customer-facing.

Use:
- `Brand 30ML`
- `Brand 50ML`
- `Brand Glass`

Examples:
- `Smirnoff Vodka 30ML`
- `Smirnoff Vodka 50ML`
- `Black & White 30ML`
- `Black Label 30ML`

This is better than vague names like:
- `BEST VODKA`
- `BLACK AND WHITE`

because it makes the sale size explicit.

## 6. Measured Sale Deduction Rule

Measured sale items should deduct from one designated source bottle size only.

Recommended operational rule:
- choose one standard service bottle size for each spirit brand
- all shots/glasses for that brand deduct from that chosen size

Example:
- `Smirnoff Vodka 30ML`
  - deduct from raw `Smirnoff Vodka 750ML`
  - qty per unit = `30`

- `Smirnoff Vodka 50ML`
  - deduct from raw `Smirnoff Vodka 750ML`
  - qty per unit = `50`

## 7. Recommended Serving Source Rule

Use this practical rule:

- if both `750ML` and `1000ML` are stocked:
  - choose one as the standard service bottle for shots/glasses
  - keep the other mainly for full-bottle sale

Suggested default:
- use `750ML` as the service bottle for measured sales
- use both `750ML` and `1000ML` for full bottle sales where sold

This avoids:
- split deduction confusion
- recipe duplication
- staff uncertainty about which bottle stock should reduce

## 8. What Not To Do

Do not:
- merge `750ML` and `1000ML` into one raw item
- use a plain bottle name without size if multiple sizes exist
- let measured sales deduct from multiple bottle sizes interchangeably

These create:
- stock drift
- price distortion
- hard-to-audit reports

## 9. Final Naming Standard

### Raw items
- `Brand + Size`

### Full bottle finished products
- `Brand + Size`

### Measured finished products
- `Brand + Measure`

Examples:
- raw item: `Black Label 1000ML`
- finished full bottle: `Black Label 1000ML`
- finished measured: `Black Label 30ML`

## 10. Execution Rule For Current Setup

Before importing or entering spirit data:

1. normalize all spirit stock names to include size
2. create full-bottle finished products using the same size-based names
3. create measured finished products using explicit measure names
4. map each measured product to one chosen source bottle size in the matrix

## 11. Recommended Default Mapping

Unless you choose otherwise:

- `250ML` bottle sale -> raw `250ML`
- `750ML` bottle sale -> raw `750ML`
- `1000ML` bottle sale -> raw `1000ML`
- `30ML` sale -> deduct from `750ML` raw item
- `50ML` sale -> deduct from `750ML` raw item
- `150ML` wine glass -> deduct from `750ML` wine bottle

This is the cleanest starting rule for the app.
