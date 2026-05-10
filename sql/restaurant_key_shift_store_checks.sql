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

alter table public.shift_store_checks enable row level security;

drop policy if exists "shift_store_checks_select_same_restaurant" on public.shift_store_checks;
create policy "shift_store_checks_select_same_restaurant"
on public.shift_store_checks
for select
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
);

drop policy if exists "shift_store_checks_insert_same_restaurant" on public.shift_store_checks;
create policy "shift_store_checks_insert_same_restaurant"
on public.shift_store_checks
for insert
to authenticated
with check (
  restaurant_id = public.current_user_restaurant_id()
);

drop policy if exists "shift_store_checks_update_same_restaurant" on public.shift_store_checks;
create policy "shift_store_checks_update_same_restaurant"
on public.shift_store_checks
for update
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
)
with check (
  restaurant_id = public.current_user_restaurant_id()
);

drop policy if exists "shift_store_checks_delete_same_restaurant" on public.shift_store_checks;
create policy "shift_store_checks_delete_same_restaurant"
on public.shift_store_checks
for delete
to authenticated
using (
  restaurant_id = public.current_user_restaurant_id()
);
