begin;

--------------------------------------------------------------------------------
-- Stock transfer access policies
--
-- Why:
-- - `stock_transfers` is now used by the app for branch-to-branch raw material
--   movement.
-- - If RLS is enabled without matching policies, inserts fail with:
--   "new row violates row-level security policy for table stock_transfers"
--------------------------------------------------------------------------------

alter table public.stock_transfers enable row level security;

drop policy if exists "stock_transfers_select_same_restaurant" on public.stock_transfers;
create policy "stock_transfers_select_same_restaurant"
on public.stock_transfers
for select
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
);

drop policy if exists "stock_transfers_insert_same_restaurant" on public.stock_transfers;
create policy "stock_transfers_insert_same_restaurant"
on public.stock_transfers
for insert
to authenticated
with check (
  restaurant_id = public.current_user_restaurant_id()
);

drop policy if exists "stock_transfers_update_same_restaurant" on public.stock_transfers;
create policy "stock_transfers_update_same_restaurant"
on public.stock_transfers
for update
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
)
with check (
  restaurant_id = public.current_user_restaurant_id()
);

drop policy if exists "stock_transfers_delete_same_restaurant" on public.stock_transfers;
create policy "stock_transfers_delete_same_restaurant"
on public.stock_transfers
for delete
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
);

commit;
