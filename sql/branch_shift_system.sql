begin;

alter table public.branches
    add column if not exists shift_system integer;

update public.branches
set shift_system = case
    when code = 'TSAVO' then 2
    when code = 'CAFE_LI' then 1
    else coalesce(shift_system, 1)
end;

alter table public.branches
    drop constraint if exists branches_shift_system_check;

alter table public.branches
    add constraint branches_shift_system_check
    check (shift_system in (1, 2));

commit;
