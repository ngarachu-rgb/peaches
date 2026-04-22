select
    column_name,
    data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'stock_receipts'
  and column_name = 'shift_id';

select
    conname,
    contype
from pg_constraint
where conname = 'stock_receipts_shift_id_fkey';

select
    indexname,
    indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'stock_receipts'
  and indexname = 'idx_stock_receipts_shift_id';
