# Bar Current Catalog Adoption

This pack converts your current Bar sheet into the app structure:

- finished products
- raw/store items
- recipe matrix rows

## Logic Used

### Direct resale items

Items with sale type:
- `can`
- `bottle`

are treated as:
- finished products
- and raw/store items

They do **not** need recipe matrix at first unless they are spirits also sold by measure.

### Measured items

Items with sale type:
- `30 ML`
- `150 ml`

are treated as:
- finished products
- and recipe-based items

They deduct from raw/store stock in `ML`.

## Important Assumptions

### Spirits sold by bottle and by 30 ML

Example:
- `BEST GIN 750 ML` = raw/store stock item
- `BEST GIN` with sale type `30 ML` = finished product

Recipe row:
- `BEST GIN` -> `BEST GIN 750 ML` = `30`

### Wine sold by 150 ml

Your sheet currently shows:
- `Red Dry Wine`
- `Red Sweet wine`
- `WHITE DRY Wine`
- `WHITE SWEET WINE`

with sale type `150 ml`, but no bottle stock rows.

So in the raw/store list I created bottle-stock source rows as:
- `Red Dry Wine Bottle`
- `Red Sweet Wine Bottle`
- `White Dry Wine Bottle`
- `White Sweet Wine Bottle`

These are assumptions to make the structure operational.

You can rename them later if you prefer a different bottle naming pattern.

## Price Handling

- raw-material CSV keeps `price = 0` for now
- finished-products CSV keeps price blank
- you said you will fill pricing later in the app

## Files

- [csv/bar_finished_products_from_current_sheet.csv](/c:/POS%20SYSTEM/csv/bar_finished_products_from_current_sheet.csv:1)
- [csv/bar_raw_materials_from_current_sheet.csv](/c:/POS%20SYSTEM/csv/bar_raw_materials_from_current_sheet.csv:1)
- [csv/bar_recipe_matrix_from_current_sheet.csv](/c:/POS%20SYSTEM/csv/bar_recipe_matrix_from_current_sheet.csv:1)
