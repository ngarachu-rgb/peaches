begin;

alter table public.stock_receipts
    add column if not exists buy_unit text,
    add column if not exists store_unit text,
    add column if not exists conversion_factor numeric,
    add column if not exists qty_posted_store numeric,
    add column if not exists buy_unit_price numeric,
    add column if not exists store_unit_price numeric,
    add column if not exists total_received_cost numeric;

commit;
