-- 1. Confirm the bar restaurant and branch ids
select
    r.id as restaurant_id,
    r.code as restaurant_code,
    b.id as branch_id,
    b.code as branch_code,
    b.name as branch_name,
    b.shift_system
from public.restaurants r
join public.branches b
    on b.restaurant_id = r.id
where r.code = 'PEACHES_BAR'
order by b.code;

-- 2. View auth users to find the auth ids after creating users in Supabase Auth
select
    id,
    email,
    created_at
from auth.users
order by created_at desc;

-- 3. Upsert Esther as the bar manager with default branch PEACHES_BAR
-- Replace AUTH_USER_UUID_HERE before running.
insert into public.profiles (
    id,
    restaurant_id,
    branch_id,
    default_branch_id,
    username,
    full_name,
    role,
    is_active
)
values (
    'AUTH_USER_UUID_HERE'::uuid,
    (
        select id
        from public.restaurants
        where code = 'PEACHES_BAR'
        limit 1
    ),
    (
        select id
        from public.branches
        where restaurant_id = (
            select id from public.restaurants where code = 'PEACHES_BAR' limit 1
        )
          and code = 'PEACHES_BAR'
        limit 1
    ),
    (
        select id
        from public.branches
        where restaurant_id = (
            select id from public.restaurants where code = 'PEACHES_BAR' limit 1
        )
          and code = 'PEACHES_BAR'
        limit 1
    ),
    'esther',
    'Esther',
    'manager',
    true
)
on conflict (id) do update
set
    restaurant_id = excluded.restaurant_id,
    branch_id = excluded.branch_id,
    default_branch_id = excluded.default_branch_id,
    username = excluded.username,
    full_name = excluded.full_name,
    role = excluded.role,
    is_active = excluded.is_active;

-- 4. Upsert Jane as supervisor for Peaches Bar branch
-- Replace JANE_AUTH_UUID_HERE before running.
insert into public.profiles (
    id,
    restaurant_id,
    branch_id,
    default_branch_id,
    username,
    full_name,
    role,
    is_active
)
values (
    'JANE_AUTH_UUID_HERE'::uuid,
    (
        select id
        from public.restaurants
        where code = 'PEACHES_BAR'
        limit 1
    ),
    (
        select id
        from public.branches
        where restaurant_id = (
            select id from public.restaurants where code = 'PEACHES_BAR' limit 1
        )
          and code = 'PEACHES_BAR'
        limit 1
    ),
    (
        select id
        from public.branches
        where restaurant_id = (
            select id from public.restaurants where code = 'PEACHES_BAR' limit 1
        )
          and code = 'PEACHES_BAR'
        limit 1
    ),
    'jane',
    'Jane',
    'supervisor',
    true
)
on conflict (id) do update
set
    restaurant_id = excluded.restaurant_id,
    branch_id = excluded.branch_id,
    default_branch_id = excluded.default_branch_id,
    username = excluded.username,
    full_name = excluded.full_name,
    role = excluded.role,
    is_active = excluded.is_active;

-- 5. Upsert Richy as supervisor for Cafe-Li Bar branch
-- Replace RICHY_AUTH_UUID_HERE before running.
insert into public.profiles (
    id,
    restaurant_id,
    branch_id,
    default_branch_id,
    username,
    full_name,
    role,
    is_active
)
values (
    'RICHY_AUTH_UUID_HERE'::uuid,
    (
        select id
        from public.restaurants
        where code = 'PEACHES_BAR'
        limit 1
    ),
    (
        select id
        from public.branches
        where restaurant_id = (
            select id from public.restaurants where code = 'PEACHES_BAR' limit 1
        )
          and code = 'CAFE_LI_BAR'
        limit 1
    ),
    (
        select id
        from public.branches
        where restaurant_id = (
            select id from public.restaurants where code = 'PEACHES_BAR' limit 1
        )
          and code = 'CAFE_LI_BAR'
        limit 1
    ),
    'richy',
    'Richy',
    'supervisor',
    true
)
on conflict (id) do update
set
    restaurant_id = excluded.restaurant_id,
    branch_id = excluded.branch_id,
    default_branch_id = excluded.default_branch_id,
    username = excluded.username,
    full_name = excluded.full_name,
    role = excluded.role,
    is_active = excluded.is_active;

-- 6. Validate bar profiles
select
    p.username,
    p.full_name,
    p.role,
    p.is_active,
    r.code as restaurant_code,
    b.code as branch_code
from public.profiles p
left join public.restaurants r on r.id = p.restaurant_id
left join public.branches b on b.id = p.branch_id
where r.code = 'PEACHES_BAR'
order by p.username;
