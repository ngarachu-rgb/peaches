select
    b.code as branch_code,
    b.name as branch_name,
    count(*) as stock_rows,
    sum(case when coalesce(m.stock_level, 0) <> 0 or coalesce(m.current_stock, 0) <> 0 then 1 else 0 end) as non_zero_stock_rows
from public.main_store m
join public.branches b
  on b.id = m.branch_id
where b.code in ('TSAVO', 'CAFE_LI')
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
where b.code = 'CAFE_LI'
order by m.name
limit 50;

select
    count(*) as finished_product_count,
    min(i.name) as first_product_name,
    max(i.name) as last_product_name
from public.inventory i
join public.restaurants r
  on r.id = i.restaurant_id
where r.code = 'PEACHES_FOOD'
  and coalesce(i.is_active, true) = true;
