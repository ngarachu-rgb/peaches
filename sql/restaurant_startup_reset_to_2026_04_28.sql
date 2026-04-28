begin;

do $$
declare
    target_restaurant_id uuid;
    branch_row record;
    new_shift_id uuid;
begin
    select id
      into target_restaurant_id
    from public.restaurants
    where code = 'PEACHES_FOOD'
    limit 1;

    if target_restaurant_id is null then
        raise exception 'Restaurant PEACHES_FOOD was not found.';
    end if;

    for branch_row in
        select id, code, name
        from public.branches
        where restaurant_id = target_restaurant_id
          and code in ('TSAVO', 'CAFE_LI')
    loop
        delete from public.shift_inventory
        where shift_id in (
            select id
            from public.shifts
            where restaurant_id = target_restaurant_id
              and branch_id = branch_row.id
        );

        delete from public.expenses
        where restaurant_id = target_restaurant_id
          and branch_id = branch_row.id;

        delete from public.debts
        where restaurant_id = target_restaurant_id
          and branch_id = branch_row.id;

        delete from public.stock_receipts
        where restaurant_id = target_restaurant_id
          and branch_id = branch_row.id;

        delete from public.shifts
        where restaurant_id = target_restaurant_id
          and branch_id = branch_row.id;

        update public.main_store
        set stock_level = 0,
            current_stock = 0
        where restaurant_id = target_restaurant_id
          and branch_id = branch_row.id;

        insert into public.shifts (
            restaurant_id,
            branch_id,
            created_at,
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
            closed_by
        )
        values (
            target_restaurant_id,
            branch_row.id,
            '2026-04-28T00:00:00Z'::timestamptz,
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
            null
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
    end loop;
end $$;

commit;
