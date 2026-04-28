# Bar Price Update Guide

Use this file to update all Bar finished-product prices at once:

- [bar_finished_products_price_update.csv](/c:/POS%20SYSTEM/csv/bar_finished_products_price_update.csv:1)

## Best way to use it

1. Open the CSV.
2. Fill only the `price` column.
3. Do not change `item_name` unless you intentionally want a different product name.
4. Save the file as CSV.
5. In the app, go to `Finished Products`.
6. Click `Preview CSV`.
7. Select the CSV file.
8. Confirm the preview looks correct.
9. Click `Import Products`.

## Important

- Existing products are updated by matching `item_name`.
- If you change a product name in the CSV, the importer may create a new product instead of updating the old one.
- `sale_type` and `notes` can stay as they are; the important fields for price update are:
  - `item_name`
  - `category`
  - `price`

## Recommended safe test

Before importing the full file:

1. Fill prices for 3 to 5 items.
2. Import and confirm those prices update correctly.
3. Then fill the rest and import the full file.
