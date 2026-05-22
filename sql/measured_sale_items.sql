begin;

alter table public.inventory
    add column if not exists is_measured_sale boolean not null default false,
    add column if not exists measured_sale_unit_size numeric,
    add column if not exists measured_sale_unit_label text;

update public.inventory
set
    is_measured_sale = coalesce(is_measured_sale, false)
where is_measured_sale is null;

commit;
