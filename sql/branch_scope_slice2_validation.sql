--------------------------------------------------------------------------------
-- 1. Branch coverage counts
--------------------------------------------------------------------------------

select
    'shifts' as table_name,
    count(*) as total_rows,
    count(*) filter (where branch_id is null) as rows_missing_branch
from public.shifts

union all

select
    'main_store' as table_name,
    count(*) as total_rows,
    count(*) filter (where branch_id is null) as rows_missing_branch
from public.main_store

union all

select
    'stock_receipts' as table_name,
    count(*) as total_rows,
    count(*) filter (where branch_id is null) as rows_missing_branch
from public.stock_receipts;

--------------------------------------------------------------------------------
-- 2. Shifts by restaurant / branch
--------------------------------------------------------------------------------

select
    r.code as restaurant_code,
    b.code as branch_code,
    count(*) as shift_count
from public.shifts s
left join public.restaurants r
    on r.id = s.restaurant_id
left join public.branches b
    on b.id = s.branch_id
group by r.code, b.code
order by r.code, b.code;

--------------------------------------------------------------------------------
-- 3. Main store rows by restaurant / branch
--------------------------------------------------------------------------------

select
    r.code as restaurant_code,
    b.code as branch_code,
    count(*) as material_count
from public.main_store m
left join public.restaurants r
    on r.id = m.restaurant_id
left join public.branches b
    on b.id = m.branch_id
group by r.code, b.code
order by r.code, b.code;

--------------------------------------------------------------------------------
-- 4. Stock receipts by restaurant / branch
--------------------------------------------------------------------------------

select
    r.code as restaurant_code,
    b.code as branch_code,
    count(*) as receipt_count
from public.stock_receipts sr
left join public.restaurants r
    on r.id = sr.restaurant_id
left join public.branches b
    on b.id = sr.branch_id
group by r.code, b.code
order by r.code, b.code;
