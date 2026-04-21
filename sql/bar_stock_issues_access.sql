begin;

--------------------------------------------------------------------------------
-- Bar stock issue access policies
--
-- Why:
-- - `bar_stock_issues` is now used by the app to record internal full-bottle
--   issues into shots / glasses stock.
-- - If RLS is enabled without matching policies, inserts fail with:
--   "new row violates row-level security policy for table bar_stock_issues"
--------------------------------------------------------------------------------

alter table public.bar_stock_issues enable row level security;

drop policy if exists "bar_stock_issues_select_same_restaurant" on public.bar_stock_issues;
create policy "bar_stock_issues_select_same_restaurant"
on public.bar_stock_issues
for select
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
);

drop policy if exists "bar_stock_issues_insert_same_restaurant" on public.bar_stock_issues;
create policy "bar_stock_issues_insert_same_restaurant"
on public.bar_stock_issues
for insert
to authenticated
with check (
  restaurant_id = public.current_user_restaurant_id()
);

drop policy if exists "bar_stock_issues_update_same_restaurant" on public.bar_stock_issues;
create policy "bar_stock_issues_update_same_restaurant"
on public.bar_stock_issues
for update
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
)
with check (
  restaurant_id = public.current_user_restaurant_id()
);

drop policy if exists "bar_stock_issues_delete_same_restaurant" on public.bar_stock_issues;
create policy "bar_stock_issues_delete_same_restaurant"
on public.bar_stock_issues
for delete
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
);

commit;
