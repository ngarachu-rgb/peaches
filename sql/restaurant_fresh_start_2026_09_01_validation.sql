--------------------------------------------------------------------------------
-- Run after restaurant_fresh_start_2026_09_01.sql.
-- Expected: one open shift per target branch, dated 2026-09-01, with zero
-- opening stock and finance balances. Bar branches are displayed for comparison
-- but are not modified by the fresh-start script.
--------------------------------------------------------------------------------

select
    r.code as restaurant_code,
    b.code as branch_code,
    s.shift_date,
    s.shift_type,
    s.total_sales,
    s.cash_at_hand as cash_opening,
    s.mpesa_float as mpesa_opening,
    s.reconciliation_notes
from public.shifts s
join public.branches b on b.id = s.branch_id
join public.restaurants r on r.id = s.restaurant_id
where r.code = 'PEACHES_FOOD'
  and b.code in ('TSAVO', 'CAFE_LI', 'PEACHES_BAR', 'CAFE_LI_BAR')
  and s.total_sales is null
order by b.code, s.created_at;

select
    b.code as branch_code,
    count(*) as opening_product_rows,
    coalesce(sum(si.bbf), 0) as total_opening_stock,
    coalesce(sum(si.added_today), 0) as total_added_stock,
    coalesce(sum(si.close_qty), 0) as total_closing_stock,
    coalesce(sum(si.sold_qty), 0) as total_sold_stock
from public.shifts s
join public.branches b on b.id = s.branch_id
left join public.shift_inventory si on si.shift_id = s.id
where s.restaurant_id = (
        select id from public.restaurants where code = 'PEACHES_FOOD'
    )
  and b.code in ('TSAVO', 'CAFE_LI')
  and s.total_sales is null
group by b.code
order by b.code;

select
    b.code as branch_code,
    count(*) as raw_material_rows,
    coalesce(sum(coalesce(m.stock_level, m.current_stock, 0)), 0) as total_live_raw_stock
from public.branches b
left join public.main_store m
  on m.restaurant_id = b.restaurant_id
 and m.branch_id = b.id
where b.restaurant_id = (
        select id from public.restaurants where code = 'PEACHES_FOOD'
    )
  and b.code in ('TSAVO', 'CAFE_LI')
group by b.code
order by b.code;
