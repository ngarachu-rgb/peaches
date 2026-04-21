--------------------------------------------------------------------------------
-- 1. Branch coverage counts
--------------------------------------------------------------------------------

select
    'expenses' as table_name,
    count(*) as total_rows,
    count(*) filter (where branch_id is null) as rows_missing_branch
from public.expenses

union all

select
    'debts' as table_name,
    count(*) as total_rows,
    count(*) filter (where branch_id is null) as rows_missing_branch
from public.debts;

--------------------------------------------------------------------------------
-- 2. Expenses by restaurant / branch
--------------------------------------------------------------------------------

select
    r.code as restaurant_code,
    b.code as branch_code,
    count(*) as expense_count,
    coalesce(sum(e.amount), 0) as expense_total
from public.expenses e
left join public.restaurants r
    on r.id = e.restaurant_id
left join public.branches b
    on b.id = e.branch_id
group by r.code, b.code
order by r.code, b.code;

--------------------------------------------------------------------------------
-- 3. Debts by restaurant / branch
--------------------------------------------------------------------------------

select
    r.code as restaurant_code,
    b.code as branch_code,
    count(*) as debt_count,
    coalesce(sum(d.amount), 0) as debt_total
from public.debts d
left join public.restaurants r
    on r.id = d.restaurant_id
left join public.branches b
    on b.id = d.branch_id
group by r.code, b.code
order by r.code, b.code;
