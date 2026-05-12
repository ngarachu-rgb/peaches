select
    s.id,
    s.created_at,
    s.shift_date,
    s.shift_type,
    case when s.total_sales is null then 'OPEN' else 'CLOSED' end as shift_status,
    s.closed_by
from public.shifts s
join public.branches b
  on b.id = s.branch_id
where b.code = 'TSAVO'
order by s.shift_date desc, s.created_at desc;

select
    b.code as branch_code,
    count(*) as stock_rows,
    sum(case when coalesce(m.stock_level, 0) <> 0 or coalesce(m.current_stock, 0) <> 0 then 1 else 0 end) as non_zero_stock_rows
from public.main_store m
join public.branches b
  on b.id = m.branch_id
where b.code = 'TSAVO'
group by b.code;

select 'stock_receipts' as table_name, count(*) as row_count
from public.stock_receipts sr
join public.branches b
  on b.id = sr.branch_id
where b.code = 'TSAVO'

union all

select 'supply_receipts' as table_name, count(*) as row_count
from public.supply_receipts sr
join public.branches b
  on b.id = sr.branch_id
where b.code = 'TSAVO'

union all

select 'expenses' as table_name, count(*) as row_count
from public.expenses e
join public.branches b
  on b.id = e.branch_id
where b.code = 'TSAVO'

union all

select 'debts' as table_name, count(*) as row_count
from public.debts d
join public.branches b
  on b.id = d.branch_id
where b.code = 'TSAVO'

union all

select 'shift_store_checks' as table_name, count(*) as row_count
from public.shift_store_checks sc
join public.branches b
  on b.id = sc.branch_id
where b.code = 'TSAVO';

select
    count(*) as open_shift_inventory_rows,
    min(i.name) as first_item_name,
    max(i.name) as last_item_name
from public.shift_inventory si
join public.shifts s
  on s.id = si.shift_id
join public.inventory i
  on i.id = si.product_id
join public.branches b
  on b.id = s.branch_id
where b.code = 'TSAVO'
  and s.shift_date = '2026-05-11'
  and s.shift_type = 'DAY'
  and s.total_sales is null;
