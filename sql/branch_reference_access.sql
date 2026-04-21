begin;

--------------------------------------------------------------------------------
-- Branch / restaurant reference access for authenticated app users
--
-- Why:
-- - The app now reads `branches` to populate transfer destinations and show
--   source branch labels.
-- - If RLS is enabled on these tables without matching select policies, the
--   authenticated client will see zero rows even though SQL Editor shows data.
--------------------------------------------------------------------------------

alter table public.restaurants enable row level security;
alter table public.branches enable row level security;

drop policy if exists "restaurants_select_same_restaurant" on public.restaurants;
create policy "restaurants_select_same_restaurant"
on public.restaurants
for select
to authenticated
using (
  id = public.current_user_restaurant_id()
);

drop policy if exists "branches_select_same_restaurant" on public.branches;
create policy "branches_select_same_restaurant"
on public.branches
for select
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
);

commit;
