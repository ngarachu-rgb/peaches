select
    b.code as branch_code,
    b.name as branch_name,
    s.id as shift_id,
    s.created_at,
    s.shift_date,
    s.shift_type,
    case when s.total_sales is null then 'OPEN' else 'CLOSED' end as shift_status,
    s.total_sales
from public.branches b
left join public.shifts s
  on s.branch_id = b.id
where b.code = 'CAFE_LI_BAR'
order by s.created_at desc nulls last
limit 5;
