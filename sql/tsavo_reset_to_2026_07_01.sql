begin;

-- TSAVO-only restaurant reset
-- Scope:
--   restaurant.code = 'PEACHES_FOOD'
--   branch.code = 'TSAVO'
--
-- Intent:
--   Start TSAVO fresh on 2026-07-01 without touching other branches.
--
-- Important:
--   Cross-branch transfer history in `stock_transfers` and `supply_transfers`
--   is intentionally left intact because those rows are shared with other
--   branches such as CAFE_LI. Deleting them would alter non-TSAVO history.

do $$
declare
    target_restaurant_id uuid;
    target_branch_id uuid;
    target_match_count integer;
    closed_shift_id uuid;
    open_shift_id uuid;
    retained_stock_transfer_count integer := 0;
    retained_supply_transfer_count integer := 0;
begin
    select count(*)
      into target_match_count
    from public.branches b
    join public.restaurants r
      on r.id = b.restaurant_id
    where r.code = 'PEACHES_FOOD'
      and b.code = 'TSAVO';

    if target_match_count <> 1 then
        raise exception 'Expected exactly 1 PEACHES_FOOD / TSAVO branch, found %.', target_match_count;
    end if;

    select r.id, b.id
      into target_restaurant_id, target_branch_id
    from public.branches b
    join public.restaurants r
      on r.id = b.restaurant_id
    where r.code = 'PEACHES_FOOD'
      and b.code = 'TSAVO';

    if target_restaurant_id is null or target_branch_id is null then
        raise exception 'PEACHES_FOOD / TSAVO could not be resolved.';
    end if;

    if to_regclass('public.stock_transfers') is not null then
        execute $stock_transfer_count$
            select count(*)
            from public.stock_transfers
            where restaurant_id = $1
              and (from_branch_id = $2 or to_branch_id = $2)
        $stock_transfer_count$
        into retained_stock_transfer_count
        using target_restaurant_id, target_branch_id;
    end if;

    if to_regclass('public.supply_transfers') is not null then
        execute $supply_transfer_count$
            select count(*)
            from public.supply_transfers
            where restaurant_id = $1
              and (from_branch_id = $2 or to_branch_id = $2)
        $supply_transfer_count$
        into retained_supply_transfer_count
        using target_restaurant_id, target_branch_id;
    end if;

    if to_regclass('public.shift_store_checks') is not null then
        execute $delete_shift_store_checks$
            delete from public.shift_store_checks
            where restaurant_id = $1
              and branch_id = $2
        $delete_shift_store_checks$
        using target_restaurant_id, target_branch_id;
    end if;

    execute $delete_shift_inventory$
        delete from public.shift_inventory
        where shift_id in (
            select s.id
            from public.shifts s
            where s.restaurant_id = $1
              and s.branch_id = $2
        )
    $delete_shift_inventory$
    using target_restaurant_id, target_branch_id;

    if to_regclass('public.bar_stock_issues') is not null then
        execute $delete_bar_stock_issues$
            delete from public.bar_stock_issues
            where restaurant_id = $1
              and branch_id = $2
        $delete_bar_stock_issues$
        using target_restaurant_id, target_branch_id;
    end if;

    execute $delete_expenses$
        delete from public.expenses
        where restaurant_id = $1
          and branch_id = $2
    $delete_expenses$
    using target_restaurant_id, target_branch_id;

    execute $delete_debts$
        delete from public.debts
        where restaurant_id = $1
          and branch_id = $2
    $delete_debts$
    using target_restaurant_id, target_branch_id;

    execute $delete_stock_receipts$
        delete from public.stock_receipts
        where restaurant_id = $1
          and branch_id = $2
    $delete_stock_receipts$
    using target_restaurant_id, target_branch_id;

    if to_regclass('public.supply_receipts') is not null then
        execute $delete_supply_receipts$
            delete from public.supply_receipts
            where restaurant_id = $1
              and branch_id = $2
        $delete_supply_receipts$
        using target_restaurant_id, target_branch_id;
    end if;

    if to_regclass('public.supply_issues') is not null then
        execute $delete_supply_issues$
            delete from public.supply_issues
            where restaurant_id = $1
              and branch_id = $2
        $delete_supply_issues$
        using target_restaurant_id, target_branch_id;
    end if;

    execute $delete_shifts$
        delete from public.shifts
        where restaurant_id = $1
          and branch_id = $2
    $delete_shifts$
    using target_restaurant_id, target_branch_id;

    update public.main_store
    set stock_level = 0,
        current_stock = 0
    where restaurant_id = target_restaurant_id
      and branch_id = target_branch_id;

    if to_regclass('public.supply_store') is not null then
        execute $reset_supply_store$
            update public.supply_store
            set stock_level = 0,
                current_stock = 0,
                updated_at = now()
            where restaurant_id = $1
              and branch_id = $2
        $reset_supply_store$
        using target_restaurant_id, target_branch_id;
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
        target_branch_id,
        '2026-06-30T23:59:00Z'::timestamptz,
        '2026-06-30',
        'NIGHT',
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        'SYSTEM RESET',
        null,
        null,
        null,
        'TSAVO-only reset seed created for 2026-07-01 startup.'
    )
    returning id into closed_shift_id;

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
        target_branch_id,
        '2026-07-01T00:00:00Z'::timestamptz,
        '2026-07-01',
        'DAY',
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
        'Fresh TSAVO open shift after branch-only reset.'
    )
    returning id into open_shift_id;

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
        open_shift_id,
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

    if to_regclass('public.shift_store_checks') is not null then
        insert into public.shift_store_checks (
            shift_id,
            restaurant_id,
            branch_id,
            material_id,
            material_name_snapshot,
            store_unit_snapshot,
            opening_qty,
            actual_closing_qty,
            expected_qty,
            variance_qty,
            notes,
            updated_at
        )
        select
            open_shift_id,
            target_restaurant_id,
            target_branch_id,
            m.id,
            m.name,
            coalesce(m.store_unit, ''),
            coalesce(m.stock_level, m.current_stock, 0),
            null,
            null,
            null,
            '',
            now()
        from public.main_store m
        where m.restaurant_id = target_restaurant_id
          and m.branch_id = target_branch_id
          and coalesce(m.is_key_shift_item, false) = true;
    end if;

    raise notice 'TSAVO reset complete for PEACHES_FOOD only.';
    raise notice 'Closed seed shift: %, open seed shift: %.', closed_shift_id, open_shift_id;
    raise notice 'Shared stock transfer rows retained: %.', retained_stock_transfer_count;
    raise notice 'Shared supply transfer rows retained: %.', retained_supply_transfer_count;
end $$;

commit;
