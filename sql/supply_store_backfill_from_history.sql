begin;

with receipt_totals as (
    select
        sr.restaurant_id,
        sr.branch_id,
        sr.supply_item_id,
        sum(coalesce(sr.qty_received, 0)) as qty_received_total
    from public.supply_receipts sr
    group by sr.restaurant_id, sr.branch_id, sr.supply_item_id
),
latest_receipts as (
    select distinct on (sr.branch_id, sr.supply_item_id)
        sr.restaurant_id,
        sr.branch_id,
        sr.supply_item_id,
        sr.item_name,
        sr.category,
        sr.buy_unit,
        coalesce(sr.unit_cost, 0) as unit_cost,
        sr.created_at
    from public.supply_receipts sr
    order by sr.branch_id, sr.supply_item_id, sr.created_at desc, sr.id desc
),
issue_totals as (
    select
        si.restaurant_id,
        si.branch_id,
        si.supply_item_id,
        sum(coalesce(si.qty_issued, 0)) as qty_issued_total
    from public.supply_issues si
    group by si.restaurant_id, si.branch_id, si.supply_item_id
),
transfer_out_totals as (
    select
        st.restaurant_id,
        st.from_branch_id as branch_id,
        st.supply_item_id,
        sum(coalesce(st.qty, 0)) as qty_transfer_out_total
    from public.supply_transfers st
    group by st.restaurant_id, st.from_branch_id, st.supply_item_id
),
transfer_in_totals as (
    select
        st.restaurant_id,
        st.to_branch_id as branch_id,
        st.supply_item_id,
        sum(coalesce(st.qty, 0)) as qty_transfer_in_total
    from public.supply_transfers st
    group by st.restaurant_id, st.to_branch_id, st.supply_item_id
),
keys as (
    select restaurant_id, branch_id, supply_item_id from receipt_totals
    union
    select restaurant_id, branch_id, supply_item_id from issue_totals
    union
    select restaurant_id, branch_id, supply_item_id from transfer_out_totals
    union
    select restaurant_id, branch_id, supply_item_id from transfer_in_totals
    union
    select restaurant_id, branch_id, supply_item_id from public.supply_store
),
calculated as (
    select
        k.restaurant_id,
        k.branch_id,
        k.supply_item_id,
        coalesce(si.name, lr.item_name, ss.item_name_snapshot, 'Supply Item') as item_name_snapshot,
        coalesce(si.category, lr.category, ss.category, 'General Supplies') as category,
        coalesce(si.buy_unit, lr.buy_unit, ss.buy_unit, '') as buy_unit,
        greatest(
            coalesce(rt.qty_received_total, 0)
            + coalesce(ti.qty_transfer_in_total, 0)
            - coalesce(it.qty_issued_total, 0)
            - coalesce(to2.qty_transfer_out_total, 0),
            0
        ) as stock_balance,
        coalesce(lr.unit_cost, ss.latest_unit_cost, 0) as latest_unit_cost,
        ss.reorder_level as reorder_level
    from keys k
    left join receipt_totals rt
        on rt.restaurant_id = k.restaurant_id
       and rt.branch_id = k.branch_id
       and rt.supply_item_id = k.supply_item_id
    left join issue_totals it
        on it.restaurant_id = k.restaurant_id
       and it.branch_id = k.branch_id
       and it.supply_item_id = k.supply_item_id
    left join transfer_out_totals to2
        on to2.restaurant_id = k.restaurant_id
       and to2.branch_id = k.branch_id
       and to2.supply_item_id = k.supply_item_id
    left join transfer_in_totals ti
        on ti.restaurant_id = k.restaurant_id
       and ti.branch_id = k.branch_id
       and ti.supply_item_id = k.supply_item_id
    left join latest_receipts lr
        on lr.restaurant_id = k.restaurant_id
       and lr.branch_id = k.branch_id
       and lr.supply_item_id = k.supply_item_id
    left join public.supply_items si
        on si.id = k.supply_item_id
    left join public.supply_store ss
        on ss.branch_id = k.branch_id
       and ss.supply_item_id = k.supply_item_id
)
insert into public.supply_store (
    restaurant_id,
    branch_id,
    supply_item_id,
    item_name_snapshot,
    category,
    buy_unit,
    stock_level,
    current_stock,
    reorder_level,
    latest_unit_cost
)
select
    restaurant_id,
    branch_id,
    supply_item_id,
    item_name_snapshot,
    category,
    buy_unit,
    stock_balance,
    stock_balance,
    reorder_level,
    latest_unit_cost
from calculated
on conflict (branch_id, supply_item_id) do update
set
    item_name_snapshot = excluded.item_name_snapshot,
    category = excluded.category,
    buy_unit = excluded.buy_unit,
    stock_level = excluded.stock_level,
    current_stock = excluded.current_stock,
    reorder_level = excluded.reorder_level,
    latest_unit_cost = excluded.latest_unit_cost,
    updated_at = now();

commit;
