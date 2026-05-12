begin;

do $$
declare
    target_restaurant_id uuid;
    target_branch_id uuid;
    closed_shift_id uuid;
    open_shift_id uuid;
begin
    select b.id, b.restaurant_id
      into target_branch_id, target_restaurant_id
    from public.branches b
    where b.code = 'TSAVO'
    limit 1;

    if target_branch_id is null then
        raise exception 'Branch TSAVO was not found.';
    end if;

    delete from public.shift_store_checks
    where restaurant_id = target_restaurant_id
      and branch_id = target_branch_id;

    delete from public.shift_inventory
    where shift_id in (
        select s.id
        from public.shifts s
        where s.restaurant_id = target_restaurant_id
          and s.branch_id = target_branch_id
    );

    delete from public.expenses
    where restaurant_id = target_restaurant_id
      and branch_id = target_branch_id;

    delete from public.debts
    where restaurant_id = target_restaurant_id
      and branch_id = target_branch_id;

    delete from public.stock_receipts
    where restaurant_id = target_restaurant_id
      and branch_id = target_branch_id;

    delete from public.supply_receipts
    where restaurant_id = target_restaurant_id
      and branch_id = target_branch_id;

    delete from public.shifts
    where restaurant_id = target_restaurant_id
      and branch_id = target_branch_id;

    update public.main_store
    set stock_level = 0,
        current_stock = 0
    where restaurant_id = target_restaurant_id
      and branch_id = target_branch_id;

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
        team_member_3
    )
    values (
        target_restaurant_id,
        target_branch_id,
        '2026-05-10T00:00:00Z'::timestamptz,
        '2026-05-10',
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
        null
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
        team_member_3
    )
    values (
        target_restaurant_id,
        target_branch_id,
        '2026-05-11T00:00:00Z'::timestamptz,
        '2026-05-11',
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
        null
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

    raise notice 'TSAVO reset complete. Closed seed shift % set to 2026-05-10 NIGHT and open shift % set to 2026-05-11 DAY.', closed_shift_id, open_shift_id;
end $$;

commit;
