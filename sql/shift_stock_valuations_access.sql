begin;

--------------------------------------------------------------------------------
-- Shift stock valuation access policies
--
-- Why:
-- - `shift_stock_valuations` stores the opening and closing stock snapshots used
--   by the estimated profit/loss report.
-- - If row level security is enabled without matching policies, inserts fail
--   with:
--   "new row violates row-level security policy for table shift_stock_valuations"
--------------------------------------------------------------------------------

alter table public.shift_stock_valuations enable row level security;

drop policy if exists "shift_stock_valuations_select_same_restaurant" on public.shift_stock_valuations;
create policy "shift_stock_valuations_select_same_restaurant"
on public.shift_stock_valuations
for select
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
);

drop policy if exists "shift_stock_valuations_insert_same_restaurant" on public.shift_stock_valuations;
create policy "shift_stock_valuations_insert_same_restaurant"
on public.shift_stock_valuations
for insert
to authenticated
with check (
  restaurant_id = public.current_user_restaurant_id()
);

drop policy if exists "shift_stock_valuations_update_same_restaurant" on public.shift_stock_valuations;
create policy "shift_stock_valuations_update_same_restaurant"
on public.shift_stock_valuations
for update
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
)
with check (
  restaurant_id = public.current_user_restaurant_id()
);

drop policy if exists "shift_stock_valuations_delete_same_restaurant" on public.shift_stock_valuations;
create policy "shift_stock_valuations_delete_same_restaurant"
on public.shift_stock_valuations
for delete
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
);

commit;
