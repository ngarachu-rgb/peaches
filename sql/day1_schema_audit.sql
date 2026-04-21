-- Day 1 Database Prep Audit
-- Run these queries in Supabase SQL Editor, section by section.

--------------------------------------------------------------------------------
-- 1. Confirm active tables exist
--------------------------------------------------------------------------------
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'profiles',
    'shifts',
    'shift_inventory',
    'inventory',
    'main_store',
    'recipes',
    'stock_receipts',
    'expenses',
    'debts'
  )
order by table_name;

--------------------------------------------------------------------------------
-- 2. Inspect full column definitions for active tables
--------------------------------------------------------------------------------
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'profiles',
    'shifts',
    'shift_inventory',
    'inventory',
    'main_store',
    'recipes',
    'stock_receipts',
    'expenses',
    'debts'
  )
order by table_name, ordinal_position;

--------------------------------------------------------------------------------
-- 3. Primary keys and unique constraints
--------------------------------------------------------------------------------
select
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as columns
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
 and tc.table_name = kcu.table_name
where tc.table_schema = 'public'
  and tc.table_name in (
    'profiles',
    'shifts',
    'shift_inventory',
    'inventory',
    'main_store',
    'recipes',
    'stock_receipts',
    'expenses',
    'debts'
  )
  and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE')
group by tc.table_name, tc.constraint_name, tc.constraint_type
order by tc.table_name, tc.constraint_type, tc.constraint_name;

--------------------------------------------------------------------------------
-- 4. Foreign keys
--------------------------------------------------------------------------------
select
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on tc.constraint_name = ccu.constraint_name
 and tc.table_schema = ccu.table_schema
where tc.table_schema = 'public'
  and tc.constraint_type = 'FOREIGN KEY'
  and tc.table_name in (
    'shift_inventory',
    'expenses',
    'debts'
  )
order by tc.table_name, tc.constraint_name;

--------------------------------------------------------------------------------
-- 5. Confirm id / shift_id data types match where expected
--------------------------------------------------------------------------------
select
  table_name,
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'shifts' and column_name = 'id') or
    (table_name = 'shift_inventory' and column_name in ('id', 'shift_id')) or
    (table_name = 'expenses' and column_name in ('id', 'shift_id')) or
    (table_name = 'debts' and column_name in ('id', 'shift_id'))
  )
order by table_name, column_name;

--------------------------------------------------------------------------------
-- 6. Check for duplicate open shifts
-- Current app treats total_sales IS NULL as open shift.
--------------------------------------------------------------------------------
select
  restaurant_id,
  count(*) as open_shift_count
from public.shifts
where total_sales is null
group by restaurant_id
having count(*) > 1;

--------------------------------------------------------------------------------
-- 7. List open shifts
--------------------------------------------------------------------------------
select
  id,
  restaurant_id,
  created_at,
  total_sales,
  cash_at_hand,
  mpesa_float,
  mpesa_closing
from public.shifts
where total_sales is null
order by created_at desc;

--------------------------------------------------------------------------------
-- 8. Orphaned shift_inventory rows
--------------------------------------------------------------------------------
select si.*
from public.shift_inventory si
left join public.shifts s
  on s.id = si.shift_id
where s.id is null
order by si.created_at desc nulls last;

--------------------------------------------------------------------------------
-- 9. Orphaned expense rows by shift_id
--------------------------------------------------------------------------------
select e.*
from public.expenses e
left join public.shifts s
  on s.id = e.shift_id
where e.shift_id is not null
  and s.id is null
order by e.created_at desc nulls last;

--------------------------------------------------------------------------------
-- 10. Orphaned debt rows by shift_id
--------------------------------------------------------------------------------
select d.*
from public.debts d
left join public.shifts s
  on s.id = d.shift_id
where d.shift_id is not null
  and s.id is null
order by d.created_at desc nulls last;

--------------------------------------------------------------------------------
-- 11. RLS enabled?
--------------------------------------------------------------------------------
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles',
    'shifts',
    'shift_inventory',
    'inventory',
    'main_store',
    'recipes',
    'stock_receipts',
    'expenses',
    'debts'
  )
order by c.relname;

--------------------------------------------------------------------------------
-- 12. Active policies
--------------------------------------------------------------------------------
select
  schemaname,
  tablename,
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'shifts',
    'shift_inventory',
    'inventory',
    'main_store',
    'recipes',
    'stock_receipts',
    'expenses',
    'debts'
  )
order by tablename, policyname;

--------------------------------------------------------------------------------
-- 13. Helpful quick counts
--------------------------------------------------------------------------------
select 'profiles' as table_name, count(*) as row_count from public.profiles
union all
select 'shifts', count(*) from public.shifts
union all
select 'shift_inventory', count(*) from public.shift_inventory
union all
select 'inventory', count(*) from public.inventory
union all
select 'main_store', count(*) from public.main_store
union all
select 'recipes', count(*) from public.recipes
union all
select 'stock_receipts', count(*) from public.stock_receipts
union all
select 'expenses', count(*) from public.expenses
union all
select 'debts', count(*) from public.debts;
