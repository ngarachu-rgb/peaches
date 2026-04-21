begin;

--------------------------------------------------------------------------------
-- Branch standardization for shifts, main_store, stock_receipts
--------------------------------------------------------------------------------

alter table public.shifts
    add column if not exists branch_id uuid;

alter table public.main_store
    add column if not exists branch_id uuid;

alter table public.stock_receipts
    add column if not exists branch_id uuid;

--------------------------------------------------------------------------------
-- Backfill current live data to PEACHES_FOOD / TSAVO
--------------------------------------------------------------------------------

with target_branch as (
    select b.id
    from public.branches b
    join public.restaurants r
        on r.id = b.restaurant_id
    where r.code = 'PEACHES_FOOD'
      and b.code = 'TSAVO'
    limit 1
)
update public.shifts
set branch_id = target_branch.id
from target_branch
where public.shifts.branch_id is null;

with target_branch as (
    select b.id
    from public.branches b
    join public.restaurants r
        on r.id = b.restaurant_id
    where r.code = 'PEACHES_FOOD'
      and b.code = 'TSAVO'
    limit 1
)
update public.main_store
set branch_id = target_branch.id
from target_branch
where public.main_store.branch_id is null;

with target_branch as (
    select b.id
    from public.branches b
    join public.restaurants r
        on r.id = b.restaurant_id
    where r.code = 'PEACHES_FOOD'
      and b.code = 'TSAVO'
    limit 1
)
update public.stock_receipts
set branch_id = target_branch.id
from target_branch
where public.stock_receipts.branch_id is null;

--------------------------------------------------------------------------------
-- Foreign keys
--------------------------------------------------------------------------------

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'shifts_branch_id_fkey'
    ) then
        alter table public.shifts
            add constraint shifts_branch_id_fkey
            foreign key (branch_id) references public.branches(id)
            on delete restrict;
    end if;
exception
    when others then null;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'main_store_branch_id_fkey'
    ) then
        alter table public.main_store
            add constraint main_store_branch_id_fkey
            foreign key (branch_id) references public.branches(id)
            on delete restrict;
    end if;
exception
    when others then null;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'stock_receipts_branch_id_fkey'
    ) then
        alter table public.stock_receipts
            add constraint stock_receipts_branch_id_fkey
            foreign key (branch_id) references public.branches(id)
            on delete restrict;
    end if;
exception
    when others then null;
end $$;

--------------------------------------------------------------------------------
-- Helpful indexes
--------------------------------------------------------------------------------

create index if not exists idx_shifts_branch_id
    on public.shifts (branch_id);

create index if not exists idx_main_store_branch_id
    on public.main_store (branch_id);

create index if not exists idx_stock_receipts_branch_id
    on public.stock_receipts (branch_id);

commit;
