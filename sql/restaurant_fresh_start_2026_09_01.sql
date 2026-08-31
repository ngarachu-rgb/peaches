begin;

--------------------------------------------------------------------------------
-- Fresh start for PEACHES_FOOD restaurant branches on 2026-09-01.
--
-- Scope: TSAVO and CAFE_LI only. Bar branches are not selected.
--
-- This keeps historical sales, procurement/receipt records, transfers, closed
-- shifts, products, recipes, and prices. It closes at most one stale open shift
-- per target branch, resets only live stock balances, then creates a blank
-- opening shift. Run this once in the Supabase SQL Editor.
--------------------------------------------------------------------------------

do $$
declare
    target_restaurant_id uuid;
    branch_row record;
    open_shift_id uuid;
    open_shift_count integer;
    target_shift_count integer;
    new_shift_id uuid;
    new_shift_type text;
begin
    select r.id
      into target_restaurant_id
    from public.restaurants r
    where r.code = 'PEACHES_FOOD';

    if target_restaurant_id is null then
        raise exception 'Restaurant PEACHES_FOOD was not found.';
    end if;

    if (
        select count(*)
        from public.branches b
        where b.restaurant_id = target_restaurant_id
          and b.code in ('TSAVO', 'CAFE_LI')
    ) <> 2 then
        raise exception 'Expected exactly the TSAVO and CAFE_LI branches under PEACHES_FOOD.';
    end if;

    for branch_row in
        select b.id, b.code, coalesce(b.shift_system, 1) as shift_system
        from public.branches b
        where b.restaurant_id = target_restaurant_id
          and b.code in ('TSAVO', 'CAFE_LI')
        order by b.code
    loop
        select count(*)
          into open_shift_count
        from public.shifts s
        where s.restaurant_id = target_restaurant_id
          and s.branch_id = branch_row.id
          and s.total_sales is null;

        if open_shift_count > 1 then
            raise exception 'Branch % has % open shifts. Resolve duplicates before running this reset.', branch_row.code, open_shift_count;
        end if;

        new_shift_type := case when branch_row.shift_system = 2 then 'DAY' else 'FULL' end;

        select count(*)
          into target_shift_count
        from public.shifts s
        where s.restaurant_id = target_restaurant_id
          and s.branch_id = branch_row.id
          and s.shift_date = date '2026-09-01'
          and s.shift_type = new_shift_type;

        if target_shift_count > 0 then
            raise exception 'Branch % already has a % shift for 2026-09-01. This reset was not applied.', branch_row.code, new_shift_type;
        end if;

        select s.id
          into open_shift_id
        from public.shifts s
        where s.restaurant_id = target_restaurant_id
          and s.branch_id = branch_row.id
          and s.total_sales is null;

        if open_shift_id is not null then
            -- Only the status and audit note change. Existing entered values stay
            -- on the old shift rather than being overwritten by this restart.
            update public.shifts
            set total_sales = 0,
                reconciliation_notes = concat_ws(E'\n', nullif(reconciliation_notes, ''),
                    'ADMINISTRATIVE RESET: Shift hard-closed for fresh start on 2026-09-01. No balances were carried forward.')
            where id = open_shift_id;
        end if;

        -- Clear the current stock state so staff can enter a new physical opening
        -- count. Historical receipt and transfer rows are not changed.
        update public.main_store
        set stock_level = 0,
            current_stock = 0
        where restaurant_id = target_restaurant_id
          and branch_id = branch_row.id;

        if to_regclass('public.supply_store') is not null then
            execute $reset_supply_store$
                update public.supply_store
                set stock_level = 0,
                    current_stock = 0,
                    updated_at = now()
                where restaurant_id = $1
                  and branch_id = $2
            $reset_supply_store$
            using target_restaurant_id, branch_row.id;
        end if;

        insert into public.shifts (
            restaurant_id,
            branch_id,
            created_at,
            shift_date,
            shift_type,
            total_sales,
            mpesa_float,
            mpesa_closing,
            mpesa_withdrawals,
            mpesa_income,
            cash_at_hand,
            total_expenses,
            total_debts,
            debts_collected,
            variance,
            closed_by,
            team_member_1,
            team_member_2,
            team_member_3,
            reconciliation_notes
        )
        values (
            target_restaurant_id,
            branch_row.id,
            '2026-09-01T00:00:00Z'::timestamptz,
            date '2026-09-01',
            new_shift_type,
            null,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
            null,
            null,
            null,
            null,
            null,
            'Fresh-start shift. Enter new physical opening stock, cash, and M-Pesa balances.'
        )
        returning id into new_shift_id;

        insert into public.shift_inventory (
            shift_id,
            product_id,
            bbf,
            added_today,
            close_qty,
            sold_qty,
            unit_price,
            line_total
        )
        select
            new_shift_id,
            i.id,
            0,
            0,
            0,
            0,
            coalesce(i.price, 0),
            0
        from public.inventory i
        where i.restaurant_id = target_restaurant_id
          and coalesce(i.is_active, true) = true;

        raise notice 'Fresh-start shift created for %: % (%).', branch_row.code, new_shift_id, new_shift_type;
    end loop;
end $$;

commit;
