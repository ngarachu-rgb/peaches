begin;

--------------------------------------------------------------------------------
-- Branch standardization for expenses and debts
--------------------------------------------------------------------------------

alter table public.expenses
    add column if not exists branch_id uuid;

alter table public.debts
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
update public.expenses
set branch_id = target_branch.id
from target_branch
where public.expenses.branch_id is null;

with target_branch as (
    select b.id
    from public.branches b
    join public.restaurants r
        on r.id = b.restaurant_id
    where r.code = 'PEACHES_FOOD'
      and b.code = 'TSAVO'
    limit 1
)
update public.debts
set branch_id = target_branch.id
from target_branch
where public.debts.branch_id is null;

--------------------------------------------------------------------------------
-- Foreign keys
--------------------------------------------------------------------------------

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'expenses_branch_id_fkey'
    ) then
        alter table public.expenses
            add constraint expenses_branch_id_fkey
            foreign key (branch_id) references public.branches(id)
            on delete restrict;
    end if;
exception
    when others then null;
end $$;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'debts_branch_id_fkey'
    ) then
        alter table public.debts
            add constraint debts_branch_id_fkey
            foreign key (branch_id) references public.branches(id)
            on delete restrict;
    end if;
exception
    when others then null;
end $$;

--------------------------------------------------------------------------------
-- Helpful indexes
--------------------------------------------------------------------------------

create index if not exists idx_expenses_branch_id
    on public.expenses (branch_id);

create index if not exists idx_debts_branch_id
    on public.debts (branch_id);

commit;
