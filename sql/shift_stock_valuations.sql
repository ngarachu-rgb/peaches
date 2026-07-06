create table if not exists public.shift_stock_valuations (
    id uuid primary key,
    restaurant_id uuid not null,
    branch_id uuid,
    shift_id uuid not null references public.shifts(id) on delete cascade,
    stock_category text not null check (stock_category in ('raw', 'supply')),
    source_item_id uuid not null,
    item_name_snapshot text not null,
    unit_snapshot text,
    opening_qty numeric not null default 0,
    opening_unit_cost numeric(12,2) not null default 0,
    opening_total_value numeric(12,2) not null default 0,
    closing_qty numeric,
    closing_unit_cost numeric(12,2),
    closing_total_value numeric(12,2),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists shift_stock_valuations_shift_item_idx
    on public.shift_stock_valuations (shift_id, stock_category, source_item_id);

create index if not exists shift_stock_valuations_shift_idx
    on public.shift_stock_valuations (shift_id);

create index if not exists shift_stock_valuations_branch_idx
    on public.shift_stock_valuations (branch_id);
