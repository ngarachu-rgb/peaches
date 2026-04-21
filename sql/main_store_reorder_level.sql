begin;

alter table public.main_store
    add column if not exists reorder_level numeric;

commit;
