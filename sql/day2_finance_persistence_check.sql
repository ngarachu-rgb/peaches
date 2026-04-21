-- Day 2 Finance Persistence Check
-- Run these after closing a test shift with:
-- - at least one expense line
-- - at least one debt given line
-- - at least one debt paid line

--------------------------------------------------------------------------------
-- 1. Latest closed shift
--------------------------------------------------------------------------------
select
  id,
  created_at,
  restaurant_id,
  total_sales,
  total_expenses,
  total_debts,
  debts_collected,
  variance,
  closed_by
from public.shifts
where total_sales is not null
order by created_at desc
limit 1;

--------------------------------------------------------------------------------
-- 2. Expense detail rows for latest closed shift
--------------------------------------------------------------------------------
with latest_closed_shift as (
  select id
  from public.shifts
  where total_sales is not null
  order by created_at desc
  limit 1
)
select
  e.id,
  e.shift_id,
  e.description,
  e.qty,
  e.unit_cost,
  e.amount,
  e.notes,
  e.created_by,
  e.created_at
from public.expenses e
join latest_closed_shift s
  on s.id = e.shift_id
order by e.created_at desc, e.id;

--------------------------------------------------------------------------------
-- 3. Debt detail rows for latest closed shift
--------------------------------------------------------------------------------
with latest_closed_shift as (
  select id
  from public.shifts
  where total_sales is not null
  order by created_at desc
  limit 1
)
select
  d.id,
  d.shift_id,
  d.transaction_type,
  d.client_name,
  d.phone,
  d.amount,
  d.status,
  d.notes,
  d.created_by,
  d.created_at
from public.debts d
join latest_closed_shift s
  on s.id = d.shift_id
order by d.created_at desc, d.id;

--------------------------------------------------------------------------------
-- 4. Compare saved shift totals vs detail-row sums
--------------------------------------------------------------------------------
with latest_closed_shift as (
  select id, total_expenses, total_debts, debts_collected
  from public.shifts
  where total_sales is not null
  order by created_at desc
  limit 1
),
expense_sum as (
  select coalesce(sum(e.amount), 0) as detail_expense_total
  from public.expenses e
  join latest_closed_shift s
    on s.id = e.shift_id
),
debt_given_sum as (
  select coalesce(sum(d.amount), 0) as detail_debt_given_total
  from public.debts d
  join latest_closed_shift s
    on s.id = d.shift_id
  where d.transaction_type = 'given'
),
debt_paid_sum as (
  select coalesce(sum(d.amount), 0) as detail_debt_paid_total
  from public.debts d
  join latest_closed_shift s
    on s.id = d.shift_id
  where d.transaction_type = 'paid'
)
select
  s.id as shift_id,
  s.total_expenses as shift_total_expenses,
  e.detail_expense_total,
  s.total_debts as shift_total_debt_given,
  g.detail_debt_given_total,
  s.debts_collected as shift_total_debt_paid,
  p.detail_debt_paid_total
from latest_closed_shift s
cross join expense_sum e
cross join debt_given_sum g
cross join debt_paid_sum p;

--------------------------------------------------------------------------------
-- 5. Flag mismatches
--------------------------------------------------------------------------------
with latest_closed_shift as (
  select id, total_expenses, total_debts, debts_collected
  from public.shifts
  where total_sales is not null
  order by created_at desc
  limit 1
),
totals as (
  select
    s.id,
    s.total_expenses,
    s.total_debts,
    s.debts_collected,
    coalesce((select sum(e.amount) from public.expenses e where e.shift_id = s.id), 0) as detail_expenses,
    coalesce((select sum(d.amount) from public.debts d where d.shift_id = s.id and d.transaction_type = 'given'), 0) as detail_debt_given,
    coalesce((select sum(d.amount) from public.debts d where d.shift_id = s.id and d.transaction_type = 'paid'), 0) as detail_debt_paid
  from latest_closed_shift s
)
select
  id as shift_id,
  (total_expenses = detail_expenses) as expenses_match,
  (total_debts = detail_debt_given) as debts_given_match,
  (debts_collected = detail_debt_paid) as debts_paid_match
from totals;
