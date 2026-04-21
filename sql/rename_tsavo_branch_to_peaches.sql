begin;

update public.branches b
set name = 'Peaches'
from public.restaurants r
where b.restaurant_id = r.id
  and r.code = 'PEACHES_FOOD'
  and b.code = 'TSAVO';

commit;
