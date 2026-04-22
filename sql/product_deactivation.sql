begin;

alter table public.inventory
add column if not exists is_active boolean not null default true;

update public.inventory
set is_active = true
where is_active is null;

commit;
