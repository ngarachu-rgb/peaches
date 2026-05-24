begin;

create extension if not exists pgcrypto;

create table if not exists public.supply_store (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references public.restaurants(id) on delete restrict,
    branch_id uuid not null references public.branches(id) on delete restrict,
    supply_item_id uuid not null references public.supply_items(id) on delete cascade,
    item_name_snapshot text not null,
    category text,
    buy_unit text,
    stock_level numeric not null default 0,
    current_stock numeric not null default 0,
    reorder_level numeric,
    latest_unit_cost numeric not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists idx_supply_store_branch_item_unique
    on public.supply_store (branch_id, supply_item_id);

create index if not exists idx_supply_store_restaurant_branch
    on public.supply_store (restaurant_id, branch_id);

create table if not exists public.supply_issues (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references public.restaurants(id) on delete restrict,
    branch_id uuid not null references public.branches(id) on delete restrict,
    shift_id uuid null references public.shifts(id) on delete set null,
    supply_item_id uuid not null references public.supply_items(id) on delete restrict,
    item_name_snapshot text not null,
    qty_issued numeric not null,
    buy_unit text,
    issued_to text not null,
    notes text,
    created_by text,
    created_at timestamptz not null default now()
);

create index if not exists idx_supply_issues_branch_created
    on public.supply_issues (branch_id, created_at desc);

create table if not exists public.supply_transfers (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references public.restaurants(id) on delete restrict,
    from_branch_id uuid not null references public.branches(id) on delete restrict,
    to_branch_id uuid not null references public.branches(id) on delete restrict,
    supply_item_id uuid not null references public.supply_items(id) on delete restrict,
    item_name_snapshot text not null,
    qty numeric not null,
    buy_unit text,
    notes text,
    created_by text,
    created_at timestamptz not null default now()
);

create index if not exists idx_supply_transfers_restaurant
    on public.supply_transfers (restaurant_id, created_at desc);

alter table public.supply_store drop constraint if exists supply_store_stock_non_negative;
alter table public.supply_store
    add constraint supply_store_stock_non_negative
    check (stock_level >= 0 and current_stock >= 0);

alter table public.supply_issues drop constraint if exists supply_issues_qty_positive;
alter table public.supply_issues
    add constraint supply_issues_qty_positive
    check (qty_issued > 0);

alter table public.supply_transfers drop constraint if exists supply_transfers_qty_positive;
alter table public.supply_transfers
    add constraint supply_transfers_qty_positive
    check (qty > 0);

alter table public.supply_transfers drop constraint if exists supply_transfers_different_branches;
alter table public.supply_transfers
    add constraint supply_transfers_different_branches
    check (from_branch_id <> to_branch_id);

alter table public.supply_store enable row level security;
alter table public.supply_issues enable row level security;
alter table public.supply_transfers enable row level security;

drop policy if exists "supply_store_select_same_restaurant" on public.supply_store;
create policy "supply_store_select_same_restaurant"
on public.supply_store
for select to authenticated
using (restaurant_id = public.current_user_restaurant_id());

drop policy if exists "supply_store_insert_same_restaurant" on public.supply_store;
create policy "supply_store_insert_same_restaurant"
on public.supply_store
for insert to authenticated
with check (restaurant_id = public.current_user_restaurant_id());

drop policy if exists "supply_store_update_same_restaurant" on public.supply_store;
create policy "supply_store_update_same_restaurant"
on public.supply_store
for update to authenticated
using (restaurant_id = public.current_user_restaurant_id())
with check (restaurant_id = public.current_user_restaurant_id());

drop policy if exists "supply_store_delete_same_restaurant" on public.supply_store;
create policy "supply_store_delete_same_restaurant"
on public.supply_store
for delete to authenticated
using (restaurant_id = public.current_user_restaurant_id());

drop policy if exists "supply_issues_select_same_restaurant" on public.supply_issues;
create policy "supply_issues_select_same_restaurant"
on public.supply_issues
for select to authenticated
using (restaurant_id = public.current_user_restaurant_id());

drop policy if exists "supply_issues_insert_same_restaurant" on public.supply_issues;
create policy "supply_issues_insert_same_restaurant"
on public.supply_issues
for insert to authenticated
with check (restaurant_id = public.current_user_restaurant_id());

drop policy if exists "supply_issues_update_same_restaurant" on public.supply_issues;
create policy "supply_issues_update_same_restaurant"
on public.supply_issues
for update to authenticated
using (restaurant_id = public.current_user_restaurant_id())
with check (restaurant_id = public.current_user_restaurant_id());

drop policy if exists "supply_issues_delete_same_restaurant" on public.supply_issues;
create policy "supply_issues_delete_same_restaurant"
on public.supply_issues
for delete to authenticated
using (restaurant_id = public.current_user_restaurant_id());

drop policy if exists "supply_transfers_select_same_restaurant" on public.supply_transfers;
create policy "supply_transfers_select_same_restaurant"
on public.supply_transfers
for select to authenticated
using (restaurant_id = public.current_user_restaurant_id());

drop policy if exists "supply_transfers_insert_same_restaurant" on public.supply_transfers;
create policy "supply_transfers_insert_same_restaurant"
on public.supply_transfers
for insert to authenticated
with check (restaurant_id = public.current_user_restaurant_id());

drop policy if exists "supply_transfers_update_same_restaurant" on public.supply_transfers;
create policy "supply_transfers_update_same_restaurant"
on public.supply_transfers
for update to authenticated
using (restaurant_id = public.current_user_restaurant_id())
with check (restaurant_id = public.current_user_restaurant_id());

drop policy if exists "supply_transfers_delete_same_restaurant" on public.supply_transfers;
create policy "supply_transfers_delete_same_restaurant"
on public.supply_transfers
for delete to authenticated
using (restaurant_id = public.current_user_restaurant_id());

commit;
