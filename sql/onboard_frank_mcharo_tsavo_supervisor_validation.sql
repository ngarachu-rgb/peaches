select
    p.id,
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
where p.username = 'frank';
