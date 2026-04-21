select
    r.code as restaurant_code,
    b.code as branch_code,
    count(*) as issue_count
from public.bar_stock_issues i
left join public.restaurants r on r.id = i.restaurant_id
left join public.branches b on b.id = i.branch_id
group by r.code, b.code
order by r.code, b.code;

select
    i.created_at,
    r.code as restaurant_code,
    b.code as branch_code,
    i.source_material_name,
    i.target_product_name,
    i.qty_issued_source,
    i.source_buy_unit,
    i.qty_added_target,
    i.target_unit,
    i.created_by
from public.bar_stock_issues i
left join public.restaurants r on r.id = i.restaurant_id
left join public.branches b on b.id = i.branch_id
order by i.created_at desc
limit 50;
