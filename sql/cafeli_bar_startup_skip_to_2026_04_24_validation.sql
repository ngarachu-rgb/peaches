select
    b.code as branch_code,
    b.name as branch_name,
    s.id as shift_id,
    s.created_at,
    case when s.total_sales is null then 'OPEN' else 'CLOSED' end as shift_status,
    s.total_sales
from public.shifts s
join public.branches b
  on b.id = s.branch_id
where b.code = 'CAFE_LI_BAR'
order by s.created_at desc
limit 5;
