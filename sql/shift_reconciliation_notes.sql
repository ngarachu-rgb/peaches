alter table public.shifts
add column if not exists reconciliation_notes text;
