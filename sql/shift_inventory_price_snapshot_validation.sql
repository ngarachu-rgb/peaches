select
    column_name,
    data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'shift_inventory'
  and column_name in ('unit_price', 'line_total')
order by column_name;
