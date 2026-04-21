select
    r.code as restaurant_code,
    b.code as branch_code,
    b.name,
    b.operating_mode,
    b.shift_system,
    b.is_active
from public.branches b
join public.restaurants r
  on r.id = b.restaurant_id
order by r.code, b.code;
