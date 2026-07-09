-- Validate the TSAVO-only reset for PEACHES_FOOD.
-- This script confirms the reset seed, zeroed balances, and preserved
-- non-TSAVO branches. Shared transfer rows involving TSAVO are expected
-- to remain unless removed manually later.

do $$
declare
    target_restaurant_id uuid;
    target_branch_id uuid;
    target_match_count integer;
    table_count bigint;
begin
    select count(*)
      into target_match_count
    from public.branches b
    join public.restaurants r
      on r.id = b.restaurant_id
    where r.code = 'PEACHES_FOOD'
      and b.code = 'TSAVO';

    if target_match_count <> 1 then
        raise exception 'Expected exactly 1 PEACHES_FOOD / TSAVO branch, found %.', target_match_count;
    end if;

    select r.id, b.id
      into target_restaurant_id, target_branch_id
    from public.branches b
    join public.restaurants r
      on r.id = b.restaurant_id
    where r.code = 'PEACHES_FOOD'
      and b.code = 'TSAVO';

    execute 'select count(*) from public.stock_receipts where restaurant_id = $1 and branch_id = $2'
        into table_count
        using target_restaurant_id, target_branch_id;
    raise notice 'TSAVO stock_receipts rows after reset: %', table_count;

    execute 'select count(*) from public.expenses where restaurant_id = $1 and branch_id = $2'
        into table_count
        using target_restaurant_id, target_branch_id;
    raise notice 'TSAVO expenses rows after reset: %', table_count;

    execute 'select count(*) from public.debts where restaurant_id = $1 and branch_id = $2'
        into table_count
        using target_restaurant_id, target_branch_id;
    raise notice 'TSAVO debts rows after reset: %', table_count;

    if to_regclass('public.bar_stock_issues') is not null then
        execute 'select count(*) from public.bar_stock_issues where restaurant_id = $1 and branch_id = $2'
            into table_count
            using target_restaurant_id, target_branch_id;
        raise notice 'TSAVO bar_stock_issues rows after reset: %', table_count;
    end if;

    if to_regclass('public.supply_receipts') is not null then
        execute 'select count(*) from public.supply_receipts where restaurant_id = $1 and branch_id = $2'
            into table_count
            using target_restaurant_id, target_branch_id;
        raise notice 'TSAVO supply_receipts rows after reset: %', table_count;
    end if;

    if to_regclass('public.supply_issues') is not null then
        execute 'select count(*) from public.supply_issues where restaurant_id = $1 and branch_id = $2'
            into table_count
            using target_restaurant_id, target_branch_id;
        raise notice 'TSAVO supply_issues rows after reset: %', table_count;
    end if;

    if to_regclass('public.shift_store_checks') is not null then
        execute 'select count(*) from public.shift_store_checks where restaurant_id = $1 and branch_id = $2'
            into table_count
            using target_restaurant_id, target_branch_id;
        raise notice 'TSAVO shift_store_checks rows after reset: %', table_count;
    end if;

    if to_regclass('public.stock_transfers') is not null then
        execute 'select count(*) from public.stock_transfers where restaurant_id = $1 and (from_branch_id = $2 or to_branch_id = $2)'
            into table_count
            using target_restaurant_id, target_branch_id;
        raise notice 'Shared stock_transfers rows retained for TSAVO: %', table_count;
    end if;

    if to_regclass('public.supply_transfers') is not null then
        execute 'select count(*) from public.supply_transfers where restaurant_id = $1 and (from_branch_id = $2 or to_branch_id = $2)'
            into table_count
            using target_restaurant_id, target_branch_id;
        raise notice 'Shared supply_transfers rows retained for TSAVO: %', table_count;
    end if;
end $$;

select
    r.code as restaurant_code,
    b.code as branch_code,
    b.name as branch_name
from public.branches b
join public.restaurants r
  on r.id = b.restaurant_id
where r.code = 'PEACHES_FOOD'
  and b.code = 'TSAVO';

select
    s.id,
    s.created_at,
    s.shift_date,
    s.shift_type,
    case when s.total_sales is null then 'OPEN' else 'CLOSED' end as shift_status,
    s.closed_by,
    s.reconciliation_notes
from public.shifts s
join public.branches b
  on b.id = s.branch_id
join public.restaurants r
  on r.id = s.restaurant_id
where r.code = 'PEACHES_FOOD'
  and b.code = 'TSAVO'
order by s.shift_date desc, s.created_at desc;

select
    b.code as branch_code,
    count(*) as stock_rows,
    sum(case when coalesce(m.stock_level, 0) <> 0 or coalesce(m.current_stock, 0) <> 0 then 1 else 0 end) as non_zero_stock_rows
from public.main_store m
join public.branches b
  on b.id = m.branch_id
join public.restaurants r
  on r.id = m.restaurant_id
where r.code = 'PEACHES_FOOD'
  and b.code = 'TSAVO'
group by b.code;

do $$
begin
    if to_regclass('public.supply_store') is not null then
        execute $supply_store_validation$
            select
                b.code as branch_code,
                count(*) as supply_rows,
                sum(case when coalesce(ss.stock_level, 0) <> 0 or coalesce(ss.current_stock, 0) <> 0 then 1 else 0 end) as non_zero_supply_rows
            from public.supply_store ss
            join public.branches b
              on b.id = ss.branch_id
            join public.restaurants r
              on r.id = ss.restaurant_id
            where r.code = 'PEACHES_FOOD'
              and b.code = 'TSAVO'
            group by b.code
        $supply_store_validation$;
    else
        raise notice 'public.supply_store does not exist; skipping supply balance validation.';
    end if;
end $$;

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
join public.restaurants r
  on r.id = s.restaurant_id
where r.code = 'PEACHES_FOOD'
  and b.code = 'TSAVO'
  and s.shift_date = '2026-07-01'
  and s.shift_type = 'DAY'
  and s.total_sales is null;

do $$
begin
    if to_regclass('public.shift_store_checks') is not null then
        execute $key_store_validation$
            select
                count(*) as open_shift_key_store_rows
            from public.shift_store_checks sc
            join public.shifts s
              on s.id = sc.shift_id
            join public.branches b
              on b.id = s.branch_id
            join public.restaurants r
              on r.id = s.restaurant_id
            where r.code = 'PEACHES_FOOD'
              and b.code = 'TSAVO'
              and s.shift_date = '2026-07-01'
              and s.shift_type = 'DAY'
              and s.total_sales is null
        $key_store_validation$;
    else
        raise notice 'public.shift_store_checks does not exist; skipping key-store validation.';
    end if;
end $$;

select
    r.code as restaurant_code,
    b.code as branch_code,
    b.name as branch_name,
    count(s.id) filter (where s.total_sales is null) as open_shift_count,
    count(s.id) filter (where s.total_sales is not null) as closed_shift_count
from public.branches b
join public.restaurants r
  on r.id = b.restaurant_id
left join public.shifts s
  on s.branch_id = b.id
where not (r.code = 'PEACHES_FOOD' and b.code = 'TSAVO')
group by r.code, b.code, b.name
order by r.code, b.code;
