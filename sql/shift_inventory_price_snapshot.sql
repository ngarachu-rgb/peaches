alter table public.shift_inventory
add column if not exists unit_price numeric(12,2);

alter table public.shift_inventory
add column if not exists line_total numeric(12,2);
