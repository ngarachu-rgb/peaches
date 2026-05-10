select
    column_name,
    data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'main_store'
  and column_name = 'is_key_shift_item';

select
    column_name,
    data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'shift_store_checks'
order by ordinal_position;

select
    count(*) as key_shift_item_count
from public.main_store
where coalesce(is_key_shift_item, false) = true;

select
    policyname,
    cmd,
    roles
from pg_policies
where schemaname = 'public'
  and tablename = 'shift_store_checks'
order by policyname;
