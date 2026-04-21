begin;

create extension if not exists pgcrypto;

alter table public.branches
    add column if not exists shift_system integer;

do $$
declare
    peaches_bar_restaurant_id uuid;
begin
    select id
    into peaches_bar_restaurant_id
    from public.restaurants
    where code = 'PEACHES_BAR'
    limit 1;

    if peaches_bar_restaurant_id is null then
        raise exception 'PEACHES_BAR restaurant was not found.';
    end if;

    update public.branches
    set
        code = 'PEACHES_BAR',
        name = 'Peaches Bar',
        shift_system = 1,
        is_active = true
    where restaurant_id = peaches_bar_restaurant_id
      and code = 'BAR';

    if not exists (
        select 1
        from public.branches
        where restaurant_id = peaches_bar_restaurant_id
          and code = 'PEACHES_BAR'
    ) then
        insert into public.branches (
            id,
            restaurant_id,
            code,
            name,
            shift_system,
            is_active
        )
        values (
            gen_random_uuid(),
            peaches_bar_restaurant_id,
            'PEACHES_BAR',
            'Peaches Bar',
            1,
            true
        );
    end if;

    if not exists (
        select 1
        from public.branches
        where restaurant_id = peaches_bar_restaurant_id
          and code = 'CAFE_LI_BAR'
    ) then
        insert into public.branches (
            id,
            restaurant_id,
            code,
            name,
            shift_system,
            is_active
        )
        values (
            gen_random_uuid(),
            peaches_bar_restaurant_id,
            'CAFE_LI_BAR',
            'Cafe-Li Bar',
            1,
            true
        );
    else
        update public.branches
        set
            name = coalesce(nullif(name, ''), 'Cafe-Li Bar'),
            shift_system = coalesce(shift_system, 1),
            is_active = true
        where restaurant_id = peaches_bar_restaurant_id
          and code = 'CAFE_LI_BAR';
    end if;
end $$;

alter table public.branches
    drop constraint if exists branches_shift_system_check;

alter table public.branches
    add constraint branches_shift_system_check
    check (shift_system in (1, 2));

commit;
