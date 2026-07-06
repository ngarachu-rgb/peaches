select
    column_name,
    data_type,
    is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'shift_stock_valuations'
order by ordinal_position;
