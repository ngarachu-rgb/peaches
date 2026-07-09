select
    b.code as branch_code,
    ss.item_name_snapshot,
    ss.category,
    ss.buy_unit,
    ss.stock_level,
    ss.current_stock,
    ss.latest_unit_cost
from public.supply_store ss
join public.branches b
  on b.id = ss.branch_id
order by b.code, ss.item_name_snapshot;
