-- Main store bulk insert template
-- Replace the restaurant_id values before running.

insert into public.main_store (
    name,
    buy_unit,
    store_unit,
    conversion_factor,
    price,
    restaurant_id
)
values
    ('Flour', 'Bale', 'Kg', 12, 1740, 'REPLACE_WITH_RESTAURANT_ID'),
    ('Sugar', 'Bag', 'Kg', 50, 6800, 'REPLACE_WITH_RESTAURANT_ID'),
    ('Cooking Oil', 'Jerrican', 'Litre', 20, 5200, 'REPLACE_WITH_RESTAURANT_ID');
