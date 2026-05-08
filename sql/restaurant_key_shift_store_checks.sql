alter table public.main_store
add column if not exists is_key_shift_item boolean not null default false;

create table if not exists public.shift_store_checks (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null,
    branch_id uuid,
    shift_id uuid not null references public.shifts(id) on delete cascade,
    material_id uuid not null references public.main_store(id) on delete cascade,
    material_name_snapshot text not null,
    store_unit_snapshot text,
    opening_qty numeric not null default 0,
    actual_closing_qty numeric,
    expected_qty numeric,
    variance_qty numeric,
    notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (shift_id, material_id)
);

create index if not exists idx_shift_store_checks_shift_id
    on public.shift_store_checks (shift_id);

create index if not exists idx_shift_store_checks_branch_id
    on public.shift_store_checks (branch_id);

