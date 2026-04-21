--------------------------------------------------------------------------------
-- 1. Restaurants
--------------------------------------------------------------------------------

select id, code, name, is_active, created_at
from public.restaurants
order by code;

--------------------------------------------------------------------------------
-- 2. Branches
--------------------------------------------------------------------------------

select
    b.id,
    r.code as restaurant_code,
    b.code as branch_code,
    b.name as branch_name,
    b.is_active,
    b.created_at
from public.branches b
join public.restaurants r
    on r.id = b.restaurant_id
order by r.code, b.code;

--------------------------------------------------------------------------------
-- 3. Profiles with mapped restaurant / branch
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
-- 4. Validation summaries
--------------------------------------------------------------------------------

select
    count(*) as total_profiles,
    count(*) filter (where restaurant_id is null) as profiles_missing_restaurant,
    count(*) filter (where branch_id is null) as profiles_missing_branch,
    count(*) filter (where role is null or trim(role) = '') as profiles_missing_role
from public.profiles;

select
    r.code as restaurant_code,
    b.code as branch_code,
    count(*) as user_count
from public.profiles p
left join public.restaurants r
    on r.id = p.restaurant_id
left join public.branches b
    on b.id = p.branch_id
group by r.code, b.code
order by r.code, b.code;
