begin;

--------------------------------------------------------------------------------
-- Reset live stock balances to zero without changing prices.
--
-- What this resets:
-- - public.main_store
--   - stock_level
--   - current_stock
-- - public.shift_inventory for currently open shifts only
--   - bbf
--   - added_today
--   - close_qty
--   - sold_qty
--
-- What this does NOT change:
-- - prices
-- - product prices
-- - stock receipt history
-- - expense / debt history
-- - closed historical shift data
--------------------------------------------------------------------------------

update public.main_store
set
  stock_level = 0,
  current_stock = 0;

update public.shift_inventory si
set
  bbf = 0,
  added_today = 0,
  close_qty = 0,
  sold_qty = 0
where exists (
  select 1
  from public.shifts s
  where s.id = si.shift_id
    and s.total_sales is null
);

commit;
