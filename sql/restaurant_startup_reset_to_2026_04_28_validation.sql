select
    b.code as branch_code,
    b.name as branch_name,
    count(distinct s.id) as shift_count,
    min(s.created_at) as earliest_shift_at,
    max(s.created_at) as latest_shift_at,
    count(*) filter (where s.total_sales is null) as open_shift_count
from public.branches b
left join public.shifts s
  on s.branch_id = b.id
where b.code in ('TSAVO', 'CAFE_LI', 'BAR', 'CAFE_LI_BAR')
group by b.code, b.name
order by b.code;

select
    b.code as branch_code,
    b.name as branch_name,
    count(*) as receipt_rows
from public.branches b
left join public.stock_receipts sr
  on sr.branch_id = b.id
where b.code in ('TSAVO', 'CAFE_LI', 'BAR', 'CAFE_LI_BAR')
group by b.code, b.name
order by b.code;

select
    b.code as branch_code,
    b.name as branch_name,
    count(*) as stock_rows,
    sum(case when coalesce(m.stock_level, 0) <> 0 or coalesce(m.current_stock, 0) <> 0 then 1 else 0 end) as non_zero_stock_rows
from public.branches b
left join public.main_store m
  on m.branch_id = b.id
where b.code in ('TSAVO', 'CAFE_LI', 'BAR', 'CAFE_LI_BAR')
group by b.code, b.name
order by b.code;
