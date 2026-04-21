begin;

create extension if not exists pgcrypto;

--------------------------------------------------------------------------------
-- Stock transfer foundation
--
-- Purpose:
--   Track branch-to-branch raw material transfers inside the same restaurant.
--
-- Current intended use:
--   TSAVO <-> CAFE_LI under PEACHES_FOOD
--
-- Notes:
-- - This foundation creates the audit table only.
-- - UI/workflow logic can be added later.
-- - Quantities should be recorded in store units.
--------------------------------------------------------------------------------

create table if not exists public.stock_transfers (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null,
    from_branch_id uuid not null,
    to_branch_id uuid not null,
    material_name text not null,
    qty numeric not null,
    unit text not null,
    notes text,
    created_by text,
    created_at timestamptz not null default now()
);

--------------------------------------------------------------------------------
-- Foreign keys
--------------------------------------------------------------------------------

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'stock_transfers_restaurant_id_fkey'
    ) then
        alter table public.stock_transfers
            add constraint stock_transfers_restaurant_id_fkey
            foreign key (restaurant_id) references public.restaurants(id)
            on delete restrict;
    end if;
exception
    when others then null;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'stock_transfers_from_branch_id_fkey'
    ) then
        alter table public.stock_transfers
            add constraint stock_transfers_from_branch_id_fkey
            foreign key (from_branch_id) references public.branches(id)
            on delete restrict;
    end if;
exception
    when others then null;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'stock_transfers_to_branch_id_fkey'
    ) then
        alter table public.stock_transfers
            add constraint stock_transfers_to_branch_id_fkey
            foreign key (to_branch_id) references public.branches(id)
            on delete restrict;
    end if;
exception
    when others then null;
end $$;

--------------------------------------------------------------------------------
-- Integrity checks
--------------------------------------------------------------------------------

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'stock_transfers_qty_positive_check'
    ) then
        alter table public.stock_transfers
            add constraint stock_transfers_qty_positive_check
            check (qty > 0);
    end if;
exception
    when others then null;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'stock_transfers_different_branches_check'
    ) then
        alter table public.stock_transfers
            add constraint stock_transfers_different_branches_check
            check (from_branch_id <> to_branch_id);
    end if;
exception
    when others then null;
end $$;

--------------------------------------------------------------------------------
-- Helpful indexes
--------------------------------------------------------------------------------

create index if not exists idx_stock_transfers_restaurant_id
    on public.stock_transfers (restaurant_id);

create index if not exists idx_stock_transfers_from_branch_id
    on public.stock_transfers (from_branch_id);

create index if not exists idx_stock_transfers_to_branch_id
    on public.stock_transfers (to_branch_id);

create index if not exists idx_stock_transfers_created_at
    on public.stock_transfers (created_at);

commit;
