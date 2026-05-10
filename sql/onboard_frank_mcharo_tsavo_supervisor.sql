--------------------------------------------------------------------------------
-- One-time staff onboarding for:
--   Frank Mcharo
--   username: frank
--   role: supervisor
--   branch: TSAVO
--   restaurant: PEACHES_FOOD
--
-- Important:
-- 1. First create the Auth user in Supabase Authentication with:
--      Email: frank@poepfebjdnhlszflhqzs.supabase.co
--      Password: Frank@0805
-- 2. Copy that Auth user's UUID from Supabase Auth.
-- 3. Replace AUTH_UUID_FOR_FRANK below, then run this SQL.
--------------------------------------------------------------------------------

insert into public.profiles (
    id,
    restaurant_id,
    branch_id,
    default_branch_id,
    username,
    full_name,
    role,
    is_active,
    created_at,
    updated_at
)
select
    'AUTH_UUID_FOR_FRANK'::uuid,
    r.id,
    b.id,
    b.id,
    'frank',
    'Frank Mcharo',
    'supervisor',
    true,
    now(),
    now()
from public.restaurants r
join public.branches b
    on b.restaurant_id = r.id
where r.code = 'PEACHES_FOOD'
  and b.code = 'TSAVO'
on conflict (id) do update
set
    restaurant_id = excluded.restaurant_id,
    branch_id = excluded.branch_id,
    default_branch_id = excluded.default_branch_id,
    username = excluded.username,
    full_name = excluded.full_name,
    role = excluded.role,
    is_active = excluded.is_active,
    updated_at = now();
