--------------------------------------------------------------------------------
-- Manual Staff Onboarding Helpers
--
-- Use this after creating the Auth user manually in Supabase Authentication.
-- Then use these queries to map or update the matching row in public.profiles.
--
-- Current structure:
--   PEACHES_FOOD -> TSAVO, CAFE_LI
--   PEACHES_BAR  -> BAR
--
-- Valid roles:
--   developer, system_admin, manager, supervisor, cashier, chef
--------------------------------------------------------------------------------

--------------------------------------------------------------------------------
-- 1. Reference: restaurants and branches
--------------------------------------------------------------------------------

select id, code, name
from public.restaurants
order by code;

select
    b.id,
    r.code as restaurant_code,
    b.code as branch_code,
    b.name as branch_name,
    b.is_active
from public.branches b
join public.restaurants r
    on r.id = b.restaurant_id
order by r.code, b.code;

--------------------------------------------------------------------------------
-- 2. Find Auth users without matching profiles
--------------------------------------------------------------------------------

select
    u.id as auth_user_id,
    u.email,
    u.created_at
from auth.users u
left join public.profiles p
    on p.id = u.id
where p.id is null
order by u.created_at desc;

--------------------------------------------------------------------------------
-- 3. View current profiles with restaurant / branch mapping
--------------------------------------------------------------------------------

select
    p.id,
    p.username,
    p.full_name,
    p.role,
    p.is_active,
    r.code as restaurant_code,
    b.code as branch_code,
    db.code as default_branch_code
from public.profiles p
left join public.restaurants r
    on r.id = p.restaurant_id
left join public.branches b
    on b.id = p.branch_id
left join public.branches db
    on db.id = p.default_branch_id
order by p.username nulls last, p.id;

--------------------------------------------------------------------------------
-- 4. Insert a new profile for an existing Auth user
--
-- Replace:
--   AUTH_USER_UUID
--   USERNAME_VALUE
--   FULL_NAME_VALUE
--   ROLE_VALUE
--   RESTAURANT_CODE_VALUE
--   BRANCH_CODE_VALUE
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
    'AUTH_USER_UUID'::uuid,
    r.id,
    b.id,
    b.id,
    'USERNAME_VALUE',
    'FULL_NAME_VALUE',
    'ROLE_VALUE',
    true,
    now(),
    now()
from public.restaurants r
join public.branches b
    on b.restaurant_id = r.id
where r.code = 'RESTAURANT_CODE_VALUE'
  and b.code = 'BRANCH_CODE_VALUE';

--------------------------------------------------------------------------------
-- 5. Update an existing profile's branch / role / active status
--
-- Replace:
--   USERNAME_VALUE
--   ROLE_VALUE
--   RESTAURANT_CODE_VALUE
--   BRANCH_CODE_VALUE
--------------------------------------------------------------------------------

update public.profiles p
set
    restaurant_id = r.id,
    branch_id = b.id,
    default_branch_id = b.id,
    role = 'ROLE_VALUE',
    is_active = true,
    updated_at = now()
from public.restaurants r
join public.branches b
    on b.restaurant_id = r.id
where p.username = 'USERNAME_VALUE'
  and r.code = 'RESTAURANT_CODE_VALUE'
  and b.code = 'BRANCH_CODE_VALUE';

--------------------------------------------------------------------------------
-- 6. Quick role-only update
--
-- Replace USERNAME_VALUE and ROLE_VALUE
--------------------------------------------------------------------------------

update public.profiles
set
    role = 'ROLE_VALUE',
    updated_at = now()
where username = 'USERNAME_VALUE';

--------------------------------------------------------------------------------
-- 7. Activate / deactivate a user
--
-- Replace USERNAME_VALUE
--------------------------------------------------------------------------------

update public.profiles
set
    is_active = false,
    updated_at = now()
where username = 'USERNAME_VALUE';

-- To reactivate:
update public.profiles
set
    is_active = true,
    updated_at = now()
where username = 'USERNAME_VALUE';

--------------------------------------------------------------------------------
-- 8. Reassign a user to another branch
--
-- Replace USERNAME_VALUE, RESTAURANT_CODE_VALUE, BRANCH_CODE_VALUE
--------------------------------------------------------------------------------

update public.profiles p
set
    restaurant_id = r.id,
    branch_id = b.id,
    default_branch_id = b.id,
    updated_at = now()
from public.restaurants r
join public.branches b
    on b.restaurant_id = r.id
where p.username = 'USERNAME_VALUE'
  and r.code = 'RESTAURANT_CODE_VALUE'
  and b.code = 'BRANCH_CODE_VALUE';

--------------------------------------------------------------------------------
-- 9. Validation: show one staff user after onboarding
--
-- Replace USERNAME_VALUE
--------------------------------------------------------------------------------

select
    p.username,
    p.full_name,
    p.role,
    p.is_active,
    r.code as restaurant_code,
    b.code as branch_code,
    db.code as default_branch_code
from public.profiles p
left join public.restaurants r
    on r.id = p.restaurant_id
left join public.branches b
    on b.id = p.branch_id
left join public.branches db
    on db.id = p.default_branch_id
where p.username = 'USERNAME_VALUE';
