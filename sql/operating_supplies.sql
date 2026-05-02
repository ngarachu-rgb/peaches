create table if not exists public.supply_items (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references public.restaurants(id) on delete cascade,
    branch_id uuid not null references public.branches(id) on delete cascade,
    name text not null,
    category text,
    buy_unit text,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
);

create table if not exists public.supply_receipts (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references public.restaurants(id) on delete cascade,
    branch_id uuid not null references public.branches(id) on delete cascade,
    shift_id uuid null references public.shifts(id) on delete set null,
    supply_item_id uuid not null references public.supply_items(id) on delete restrict,
    item_name text not null,
    category text,
    qty_received numeric(12,2) not null default 0,
    buy_unit text,
    total_received_cost numeric(12,2) not null default 0,
    unit_cost numeric(12,2) not null default 0,
    notes text,
    received_by text,
    created_at timestamptz not null default now()
);

create unique index if not exists idx_supply_items_branch_name_unique
on public.supply_items (branch_id, lower(name));

create index if not exists idx_supply_items_restaurant_branch
on public.supply_items (restaurant_id, branch_id);

create index if not exists idx_supply_receipts_restaurant_branch_created
on public.supply_receipts (restaurant_id, branch_id, created_at desc);

create index if not exists idx_supply_receipts_shift_id
on public.supply_receipts (shift_id);
