select
    column_name,
    data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'shifts'
  and column_name in ('team_member_1', 'team_member_2', 'team_member_3')
order by column_name;

select
    id,
    shift_date,
    shift_type,
    team_member_1,
    team_member_2,
    team_member_3
from public.shifts
order by created_at desc
limit 10;
