select
    b.code as branch_code,
    b.name as branch_name,
    count(*) as item_count,
    sum(case when coalesce(m.stock_level, 0) <> 0 or coalesce(m.current_stock, 0) <> 0 then 1 else 0 end) as rows_with_non_zero_stock
from public.main_store m
join public.branches b
  on b.id = m.branch_id
where b.code in ('PEACHES_BAR', 'CAFE_LI_BAR')
group by b.code, b.name
order by b.code;

select
    m.name,
    m.buy_unit,
    m.store_unit,
    m.conversion_factor,
    m.price,
    m.reorder_level,
    m.stock_level,
    m.current_stock
from public.main_store m
join public.branches b
  on b.id = m.branch_id
where b.code = 'CAFE_LI_BAR'
order by m.name
limit 30;
