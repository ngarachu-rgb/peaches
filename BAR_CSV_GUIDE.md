# Bar CSV Guide

The starter CSV files are in [csv](/c:/POS%20SYSTEM/csv).

Files:
- [csv/bar_raw_materials_starter.csv](/c:/POS%20SYSTEM/csv/bar_raw_materials_starter.csv:1)
- [csv/bar_finished_products_starter.csv](/c:/POS%20SYSTEM/csv/bar_finished_products_starter.csv:1)
- [csv/bar_recipe_matrix_starter.csv](/c:/POS%20SYSTEM/csv/bar_recipe_matrix_starter.csv:1)

## What Each File Is For

### `bar_raw_materials_starter.csv`

Use this with the existing `Raw Materials` CSV import.

Before importing:
- replace the `price` values from `0` to your actual buy prices
- review conversion factors if any item is packed differently in your bar

Current format matches the app importer:
- `item_code`
- `name`
- `buy_unit`
- `store_unit`
- `conversion_factor`
- `price`
- `restaurant_id`

## `bar_finished_products_starter.csv`

This is a structured entry sheet.

The app does not yet have CSV import for finished products, so use this file as:
- your pricing worksheet
- or copy values into `Finished Products`

Fill the `price` column before entry.

This sheet now includes:
- bottled/canned direct-sale items
- full spirit bottle sales
- shots
- doubles
- glasses
- minimal cocktails

## `bar_recipe_matrix_starter.csv`

This is a structured recipe-entry sheet.

The app does not yet have CSV import for recipe rows, so use it as:
- the recipe design sheet
- or copy rows into `Inventory Matrix`

Spirits are modeled as:
- raw item buy unit = `Bottle`
- raw item store unit = `ML`

So the same raw spirit stock supports:
- bottle sale
- shot
- double
- glass
- cocktail

## Recommended Entry Order

1. Edit prices in `bar_raw_materials_starter.csv`
2. Import raw materials
3. Fill prices in `bar_finished_products_starter.csv`
4. Enter finished products in the app
5. Enter recipe rows from `bar_recipe_matrix_starter.csv`
  This now includes full-bottle spirit deduction rows as well as shots, doubles, glasses, and cocktails.
6. Receive opening stock
7. Run a small bar dry run
