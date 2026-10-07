--------------------------------------------------------------------------------
-- Validation for main_store_unit_conversion.sql
--------------------------------------------------------------------------------

select
    to_regclass('public.stock_unit_conversions') as audit_table,
    to_regprocedure(
        'public.update_main_store_units_with_stock_conversion(uuid,uuid,uuid,text,text,text,numeric,numeric,numeric,boolean,text,text)'
    ) as conversion_function;

-- Must return zero rows. Same-unit stock must always use factor 1.
select
    r.code as restaurant_code,
    b.code as branch_code,
    ms.id,
    ms.name,
    ms.buy_unit,
    ms.store_unit,
    ms.conversion_factor,
    ms.stock_level
from public.main_store ms
join public.restaurants r on r.id = ms.restaurant_id
join public.branches b on b.id = ms.branch_id
where lower(trim(coalesce(ms.buy_unit, ''))) = lower(trim(coalesce(ms.store_unit, '')))
  and ms.conversion_factor <> 1
order by r.code, b.code, ms.name;

-- Recent audited conversions.
select
    r.code as restaurant_code,
    b.code as branch_code,
    c.material_name,
    c.old_stock_level,
    c.old_store_unit,
    c.old_conversion_factor,
    c.new_stock_level,
    c.new_store_unit,
    c.new_conversion_factor,
    c.reason,
    c.changed_by,
    c.created_at
from public.stock_unit_conversions c
join public.restaurants r on r.id = c.restaurant_id
join public.branches b on b.id = c.branch_id
order by c.created_at desc
limit 50;
