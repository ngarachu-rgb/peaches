select *
from (
    select 'supply_store_exists' as check_name,
           exists (
               select 1 from information_schema.tables
               where table_schema = 'public' and table_name = 'supply_store'
           ) as ok
    union all
    select 'supply_issues_exists',
           exists (
               select 1 from information_schema.tables
               where table_schema = 'public' and table_name = 'supply_issues'
           )
    union all
    select 'supply_transfers_exists',
           exists (
               select 1 from information_schema.tables
               where table_schema = 'public' and table_name = 'supply_transfers'
           )
    union all
    select 'supply_store_rls_enabled',
           coalesce((
               select c.relrowsecurity
               from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'supply_store'
           ), false)
    union all
    select 'supply_issues_rls_enabled',
           coalesce((
               select c.relrowsecurity
               from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'supply_issues'
           ), false)
    union all
    select 'supply_transfers_rls_enabled',
           coalesce((
               select c.relrowsecurity
               from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = 'supply_transfers'
           ), false)
    union all
    select 'supply_store_select_policy',
           exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'supply_store' and policyname = 'supply_store_select_same_restaurant')
    union all
    select 'supply_issues_insert_policy',
           exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'supply_issues' and policyname = 'supply_issues_insert_same_restaurant')
    union all
    select 'supply_transfers_insert_policy',
           exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'supply_transfers' and policyname = 'supply_transfers_insert_same_restaurant')
    union all
    select 'supply_store_unique_branch_item',
           exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'supply_store' and indexname = 'idx_supply_store_branch_item_unique')
) checks
order by check_name;

select
    b.code as branch_code,
    ss.item_name_snapshot,
    ss.buy_unit,
    ss.stock_level,
    ss.latest_unit_cost
from public.supply_store ss
join public.branches b on b.id = ss.branch_id
order by b.code, ss.item_name_snapshot
limit 100;
