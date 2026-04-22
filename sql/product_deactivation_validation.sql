select
    coalesce(is_active, true) as is_active,
    count(*) as product_count
from public.inventory
group by coalesce(is_active, true)
order by is_active desc;
