alter table public.shifts
add column if not exists team_member_1 text,
add column if not exists team_member_2 text,
add column if not exists team_member_3 text;
