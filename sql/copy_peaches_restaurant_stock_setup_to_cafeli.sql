insert into public.main_store (
    restaurant_id,
    branch_id,
    name,
    buy_unit,
    store_unit,
    conversion_factor,
    price,
    reorder_level,
    stock_level,
    current_stock
)
select
    src.restaurant_id,
    dst_branch.id as branch_id,
    src.name,
    src.buy_unit,
    src.store_unit,
    coalesce(src.conversion_factor, 1),
    coalesce(src.price, 0),
    src.reorder_level,
    0 as stock_level,
    0 as current_stock
from public.main_store src
join public.branches src_branch
  on src_branch.id = src.branch_id
join public.branches dst_branch
  on dst_branch.code = 'CAFE_LI'
 and dst_branch.restaurant_id = src.restaurant_id
where src_branch.code = 'TSAVO'
  and not exists (
      select 1
      from public.main_store existing
      where existing.restaurant_id = src.restaurant_id
        and existing.branch_id = dst_branch.id
        and lower(trim(existing.name)) = lower(trim(src.name))
  );
