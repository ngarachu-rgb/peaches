select
    r.code as restaurant_code,
    b.code as branch_code,
    b.name as branch_name,
    b.shift_system
from public.branches b
join public.restaurants r
    on r.id = b.restaurant_id
order by r.code, b.code;
