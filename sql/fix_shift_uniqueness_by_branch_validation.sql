select
    con.conname as constraint_name,
    pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel
    on rel.oid = con.conrelid
join pg_namespace nsp
    on nsp.oid = rel.relnamespace
where nsp.nspname = 'public'
  and rel.relname = 'shifts'
  and con.contype = 'u'
order by con.conname;

select
    b.code as branch_code,
    b.name as branch_name,
    s.shift_date,
    s.shift_type,
    count(*) as matching_shift_rows
from public.shifts s
join public.branches b
    on b.id = s.branch_id
where b.code in ('TSAVO', 'CAFE_LI', 'BAR', 'CAFE_LI_BAR')
group by b.code, b.name, s.shift_date, s.shift_type
having count(*) > 1
order by b.code, s.shift_date desc nulls last, s.shift_type;
