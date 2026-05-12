select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('supply_items', 'supply_receipts')
order by table_name;

select
    table_name,
    column_name,
    data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('supply_items', 'supply_receipts')
order by table_name, ordinal_position;

select
    indexname,
    indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('supply_items', 'supply_receipts')
order by tablename, indexname;

select
    schemaname,
    tablename,
    policyname,
    cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('supply_items', 'supply_receipts')
order by tablename, policyname;
