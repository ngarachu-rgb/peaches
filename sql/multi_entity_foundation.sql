begin;

create extension if not exists pgcrypto;

--------------------------------------------------------------------------------
-- 1. Core entity tables
--------------------------------------------------------------------------------

create table if not exists public.restaurants (
    id uuid primary key default gen_random_uuid(),
    code text not null unique,
    name text not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.branches (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references public.restaurants(id) on delete cascade,
    code text not null,
    name text not null,
    is_active boolean not null default true,
    created_at timestamptz not null default now(),
    constraint branches_restaurant_code_key unique (restaurant_id, code)
);

alter table public.restaurants
    add column if not exists code text,
    add column if not exists name text,
    add column if not exists is_active boolean default true,
    add column if not exists created_at timestamptz default now();

alter table public.branches
    add column if not exists restaurant_id uuid,
    add column if not exists code text,
    add column if not exists name text,
    add column if not exists is_active boolean default true,
    add column if not exists created_at timestamptz default now();

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'branches_restaurant_id_fkey'
    ) then
        alter table public.branches
            add constraint branches_restaurant_id_fkey
            foreign key (restaurant_id) references public.restaurants(id)
            on delete cascade;
    end if;
exception
    when others then null;
end $$;

create unique index if not exists restaurants_code_key
    on public.restaurants (code)
    where code is not null;

create unique index if not exists branches_restaurant_code_key
    on public.branches (restaurant_id, code)
    where restaurant_id is not null and code is not null;

--------------------------------------------------------------------------------
-- 2. Profiles standardization
--------------------------------------------------------------------------------

alter table public.profiles
    add column if not exists full_name text,
    add column if not exists branch_id uuid,
    add column if not exists default_branch_id uuid,
    add column if not exists is_active boolean default true,
    add column if not exists created_at timestamptz default now(),
    add column if not exists updated_at timestamptz default now();

update public.profiles
set
    full_name = coalesce(nullif(full_name, ''), username),
    is_active = coalesce(is_active, true),
    created_at = coalesce(created_at, now()),
    updated_at = coalesce(updated_at, now());

--------------------------------------------------------------------------------
-- 3. Seed restaurants using the existing live restaurant_id for PEACHES_FOOD
--------------------------------------------------------------------------------

do $$
declare
    peaches_food_id uuid := coalesce(
        (select restaurant_id from public.profiles where restaurant_id is not null limit 1),
        (select restaurant_id from public.shifts where restaurant_id is not null limit 1),
        '550e8400-e29b-41d4-a716-446655440000'::uuid
    );
    peaches_bar_id uuid := gen_random_uuid();
begin
    update public.restaurants
    set
        code = coalesce(code, 'PEACHES_FOOD'),
        name = coalesce(name, 'Peaches Food'),
        is_active = coalesce(is_active, true),
        created_at = coalesce(created_at, now())
    where id = peaches_food_id;

    if not exists (
        select 1 from public.restaurants where code = 'PEACHES_FOOD'
    ) then
        insert into public.restaurants (id, code, name, is_active)
        values (peaches_food_id, 'PEACHES_FOOD', 'Peaches Food', true);
    end if;

    if exists (
        select 1 from public.restaurants where code = 'PEACHES_BAR'
    ) then
        select id into peaches_bar_id
        from public.restaurants
        where code = 'PEACHES_BAR'
        limit 1;
    end if;

    if not exists (
        select 1 from public.restaurants where code = 'PEACHES_BAR'
    ) then
        insert into public.restaurants (id, code, name, is_active)
        values (peaches_bar_id, 'PEACHES_BAR', 'Peaches Bar', true);
    end if;
end $$;

--------------------------------------------------------------------------------
-- 4. Seed branches
--------------------------------------------------------------------------------

insert into public.branches (restaurant_id, code, name, is_active)
select r.id, x.code, x.name, true
from public.restaurants r
join (
    values
        ('PEACHES_FOOD', 'TSAVO', 'Peaches Tsavo'),
        ('PEACHES_FOOD', 'CAFE_LI', 'Cafe-Li'),
        ('PEACHES_BAR', 'BAR', 'Peaches Bar')
) as x(restaurant_code, code, name)
    on x.restaurant_code = r.code
where not exists (
    select 1
    from public.branches b
    where b.restaurant_id = r.id
      and b.code = x.code
);

--------------------------------------------------------------------------------
-- 5. Backfill profile ownership and branch assignment
--------------------------------------------------------------------------------

update public.profiles p
set restaurant_id = r.id
from public.restaurants r
where p.restaurant_id is null
  and r.code = 'PEACHES_FOOD';

update public.profiles p
set
    restaurant_id = r.id,
    branch_id = b.id,
    default_branch_id = b.id,
    updated_at = now()
from public.restaurants r
join public.branches b
    on b.restaurant_id = r.id
where r.code = 'PEACHES_FOOD'
  and b.code = 'TSAVO'
  and lower(coalesce(p.username, '')) in ('ngarachu', 'njeri');

update public.profiles p
set
    restaurant_id = r.id,
    branch_id = b.id,
    default_branch_id = b.id,
    updated_at = now()
from public.restaurants r
join public.branches b
    on b.restaurant_id = r.id
where r.code = 'PEACHES_FOOD'
  and b.code = 'CAFE_LI'
  and lower(coalesce(p.username, '')) = 'richard';

update public.profiles p
set
    restaurant_id = r.id,
    branch_id = b.id,
    default_branch_id = b.id,
    updated_at = now()
from public.restaurants r
join public.branches b
    on b.restaurant_id = r.id
where r.code = 'PEACHES_BAR'
  and b.code = 'BAR'
  and lower(coalesce(p.username, '')) = 'esther';

update public.profiles p
set
    branch_id = b.id,
    default_branch_id = coalesce(p.default_branch_id, b.id),
    updated_at = now()
from public.restaurants r
join public.branches b
    on b.restaurant_id = r.id
where r.code = 'PEACHES_FOOD'
  and b.code = 'TSAVO'
  and p.restaurant_id = r.id
  and p.branch_id is null;

--------------------------------------------------------------------------------
-- 6. Foreign keys after backfill
--------------------------------------------------------------------------------

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'profiles_restaurant_id_fkey'
    ) then
        alter table public.profiles
            add constraint profiles_restaurant_id_fkey
            foreign key (restaurant_id) references public.restaurants(id)
            on delete restrict;
    end if;
exception
    when others then null;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'profiles_branch_id_fkey'
    ) then
        alter table public.profiles
            add constraint profiles_branch_id_fkey
            foreign key (branch_id) references public.branches(id)
            on delete restrict;
    end if;
exception
    when others then null;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'profiles_default_branch_id_fkey'
    ) then
        alter table public.profiles
            add constraint profiles_default_branch_id_fkey
            foreign key (default_branch_id) references public.branches(id)
            on delete restrict;
    end if;
exception
    when others then null;
end $$;

commit;
