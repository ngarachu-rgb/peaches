begin;

alter table public.stock_receipts
    add column if not exists shift_id uuid;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'stock_receipts_shift_id_fkey'
    ) then
        alter table public.stock_receipts
            add constraint stock_receipts_shift_id_fkey
            foreign key (shift_id) references public.shifts(id) on delete set null;
    end if;
end $$;

create index if not exists idx_stock_receipts_shift_id
    on public.stock_receipts (shift_id);

commit;
