--------------------------------------------------------------------------------
-- Validation after resetting live stock balances to zero
--------------------------------------------------------------------------------

select
  r.code as restaurant_code,
  b.code as branch_code,
  count(*) as material_count,
  coalesce(sum(coalesce(m.stock_level, m.current_stock, 0)), 0) as total_store_stock
from public.main_store m
left join public.restaurants r on r.id = m.restaurant_id
left join public.branches b on b.id = m.branch_id
group by r.code, b.code
order by r.code, b.code;

select
  r.code as restaurant_code,
  b.code as branch_code,
  count(*) as shift_inventory_rows,
  coalesce(sum(si.bbf), 0) as total_opening,
  coalesce(sum(si.added_today), 0) as total_added,
  coalesce(sum(si.close_qty), 0) as total_closing,
  coalesce(sum(si.sold_qty), 0) as total_sold
from public.shift_inventory si
join public.shifts s on s.id = si.shift_id
left join public.restaurants r on r.id = s.restaurant_id
left join public.branches b on b.id = s.branch_id
where s.total_sales is null
group by r.code, b.code
order by r.code, b.code;
