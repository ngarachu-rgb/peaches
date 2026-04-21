# Main Store Import

This project now includes three ways to bulk load `main_store` data:

1. CSV template for Excel or Supabase import:
   - [templates/main_store_import_template.csv](/c:/POS%20SYSTEM/templates/main_store_import_template.csv:1)
2. SQL bulk insert template:
   - [sql/main_store_bulk_insert.sql](/c:/POS%20SYSTEM/sql/main_store_bulk_insert.sql:1)
3. Local Node import script:
   - [scripts/import-main-store.mjs](/c:/POS%20SYSTEM/scripts/import-main-store.mjs:1)

## Excel to CSV format

Use these exact headers:

```csv
name,buy_unit,store_unit,conversion_factor,price,restaurant_id
```

Your screen labels map like this:

- `NAME` -> `name`
- `BUY UNIT` -> `buy_unit`
- `STORE UNIT` -> `store_unit`
- `CONV.` -> `conversion_factor`
- `BUY PRICE` -> `price`

If every row belongs to the same restaurant, you can leave `restaurant_id` out of the CSV and pass it in the script with `--restaurant-id`.

## Supabase Table Editor import

1. Open `main_store` in Supabase.
2. Choose CSV import.
3. Make sure the file uses these column names:
   - `name`
   - `buy_unit`
   - `store_unit`
   - `conversion_factor`
   - `price`
   - `restaurant_id`

## SQL import

Use [sql/main_store_bulk_insert.sql](/c:/POS%20SYSTEM/sql/main_store_bulk_insert.sql:1), replace `REPLACE_WITH_RESTAURANT_ID`, then run it in Supabase SQL Editor.

## Script import

The script validates:

- `name` exists
- `buy_unit` exists
- `store_unit` exists
- `conversion_factor > 0`
- `price >= 0`
- `restaurant_id` exists either in the CSV or via `--restaurant-id`

### Example command

```powershell
node scripts/import-main-store.mjs --csv .\templates\main_store_import_template.csv --restaurant-id YOUR_RESTAURANT_ID
```

### Optional env vars

The script supports:

- `SUPABASE_URL`
- `SUPABASE_KEY`

If not provided, it falls back to the current project URL and public key. For bigger bulk imports, using a service-role key is safer and more reliable than the anon key.
