--------------------------------------------------------------------------------
-- Manual Staff Onboarding Examples
--
-- Replace AUTH UUIDs with the ids of users created in Supabase Auth.
--------------------------------------------------------------------------------

--------------------------------------------------------------------------------
-- Example: Tsavo manager (njeri)
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
    'AUTH_UUID_FOR_NJERI'::uuid,
    r.id,
    b.id,
    b.id,
    'njeri',
    'Njeri',
    'manager',
    true,
    now(),
    now()
from public.restaurants r
join public.branches b
    on b.restaurant_id = r.id
where r.code = 'PEACHES_FOOD'
  and b.code = 'TSAVO';

--------------------------------------------------------------------------------
-- Example: Cafe-Li manager (richard)
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
    'AUTH_UUID_FOR_RICHARD'::uuid,
    r.id,
    b.id,
    b.id,
    'richard',
    'Richard',
    'manager',
    true,
    now(),
    now()
from public.restaurants r
join public.branches b
    on b.restaurant_id = r.id
where r.code = 'PEACHES_FOOD'
  and b.code = 'CAFE_LI';

--------------------------------------------------------------------------------
-- Example: Bar manager (esther)
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
    'AUTH_UUID_FOR_ESTHER'::uuid,
    r.id,
    b.id,
    b.id,
    'esther',
    'Esther',
    'manager',
    true,
    now(),
    now()
from public.restaurants r
join public.branches b
    on b.restaurant_id = r.id
where r.code = 'PEACHES_BAR'
  and b.code = 'BAR';
