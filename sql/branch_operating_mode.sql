alter table public.branches
add column if not exists operating_mode text;

update public.branches
set operating_mode = case
    when code in ('PEACHES_BAR', 'CAFE_LI_BAR') then 'DIRECT_SALES'
    else 'FOOD_PRODUCTION'
end
where operating_mode is null
   or operating_mode not in ('FOOD_PRODUCTION', 'DIRECT_SALES');

alter table public.branches
drop constraint if exists branches_operating_mode_check;

alter table public.branches
add constraint branches_operating_mode_check
check (operating_mode in ('FOOD_PRODUCTION', 'DIRECT_SALES'));
