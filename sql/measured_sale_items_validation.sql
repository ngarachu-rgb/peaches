select
    column_name,
    data_type,
    is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'inventory'
  and column_name in (
      'is_measured_sale',
      'measured_sale_unit_size',
      'measured_sale_unit_label'
  )
order by column_name;

select
    id,
    name,
    category,
    price,
    is_measured_sale,
    measured_sale_unit_size,
    measured_sale_unit_label
from public.inventory
where coalesce(is_measured_sale, false) = true
order by name;
