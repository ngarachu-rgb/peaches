--------------------------------------------------------------------------------
-- 1. Check table exists and row count
--------------------------------------------------------------------------------

select
    'stock_transfers' as table_name,
    count(*) as total_rows
from public.stock_transfers;

--------------------------------------------------------------------------------
-- 2. Validate transfers with restaurant / branch labels
--------------------------------------------------------------------------------

select
    st.id,
    r.code as restaurant_code,
    fb.code as from_branch_code,
    tb.code as to_branch_code,
    st.material_name,
    st.qty,
    st.unit,
    st.created_by,
    st.created_at
from public.stock_transfers st
left join public.restaurants r
    on r.id = st.restaurant_id
left join public.branches fb
    on fb.id = st.from_branch_id
left join public.branches tb
    on tb.id = st.to_branch_id
order by st.created_at desc;

--------------------------------------------------------------------------------
-- 3. Quick integrity check for same-branch mistakes
--------------------------------------------------------------------------------

select
    count(*) as invalid_same_branch_rows
from public.stock_transfers
where from_branch_id = to_branch_id;
