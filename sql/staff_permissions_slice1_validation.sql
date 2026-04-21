--------------------------------------------------------------------------------
-- 1. Profile role distribution
--------------------------------------------------------------------------------

select
    role,
    count(*) as user_count
from public.profiles
group by role
order by role nulls first;

--------------------------------------------------------------------------------
-- 2. Invalid / missing roles
--------------------------------------------------------------------------------

select
    id,
    username,
    full_name,
    role,
    is_active
from public.profiles
where role is null
   or role not in ('developer', 'system_admin', 'manager', 'cashier', 'chef')
order by username nulls last, id;

--------------------------------------------------------------------------------
-- 3. Full profile mapping
--------------------------------------------------------------------------------

select
    p.username,
    p.full_name,
    p.role,
    p.is_active,
    r.code as restaurant_code,
    b.code as branch_code
from public.profiles p
left join public.restaurants r
    on r.id = p.restaurant_id
left join public.branches b
    on b.id = p.branch_id
order by p.username nulls last, p.id;
