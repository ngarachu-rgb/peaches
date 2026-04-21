alter table if exists public.bar_stock_issues
add column if not exists branch_id uuid;

create table if not exists public.bar_stock_issues (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null,
    branch_id uuid,
    shift_id uuid not null,
    source_material_name text not null,
    target_product_name text not null,
    qty_issued_source numeric not null check (qty_issued_source > 0),
    source_buy_unit text,
    qty_added_target numeric not null check (qty_added_target > 0),
    target_unit text,
    conversion_factor numeric not null check (conversion_factor > 0),
    notes text,
    created_by text,
    created_at timestamptz not null default now()
);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'bar_stock_issues_shift_id_fkey'
    ) then
        alter table public.bar_stock_issues
        add constraint bar_stock_issues_shift_id_fkey
        foreign key (shift_id) references public.shifts(id) on delete cascade;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'bar_stock_issues_restaurant_id_fkey'
    ) then
        alter table public.bar_stock_issues
        add constraint bar_stock_issues_restaurant_id_fkey
        foreign key (restaurant_id) references public.restaurants(id) on delete cascade;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'bar_stock_issues_branch_id_fkey'
    ) then
        alter table public.bar_stock_issues
        add constraint bar_stock_issues_branch_id_fkey
        foreign key (branch_id) references public.branches(id) on delete cascade;
    end if;
end $$;

create index if not exists idx_bar_stock_issues_restaurant_shift
on public.bar_stock_issues (restaurant_id, shift_id, created_at desc);

create index if not exists idx_bar_stock_issues_branch_created
on public.bar_stock_issues (branch_id, created_at desc);
