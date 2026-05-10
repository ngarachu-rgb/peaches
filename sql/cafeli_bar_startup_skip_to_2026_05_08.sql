do $$
declare
    target_branch_id uuid;
    target_restaurant_id uuid;
    open_shift_id uuid;
    latest_closed_shift_id uuid;
begin
    select b.id, b.restaurant_id
      into target_branch_id, target_restaurant_id
    from public.branches b
    where b.code = 'CAFE_LI_BAR'
    limit 1;

    if target_branch_id is null then
        raise exception 'Branch CAFE_LI_BAR was not found.';
    end if;

    select s.id
      into open_shift_id
    from public.shifts s
    where s.restaurant_id = target_restaurant_id
      and s.branch_id = target_branch_id
      and s.total_sales is null
    order by s.created_at desc
    limit 1;

    if open_shift_id is not null then
        update public.shifts
        set created_at = '2026-05-08T00:00:00Z'::timestamptz,
            shift_date = '2026-05-08'
        where id = open_shift_id;

        raise notice 'Updated open shift % for CAFE_LI_BAR to 2026-05-08.', open_shift_id;
        return;
    end if;

    select s.id
      into latest_closed_shift_id
    from public.shifts s
    where s.restaurant_id = target_restaurant_id
      and s.branch_id = target_branch_id
      and s.total_sales is not null
    order by s.created_at desc
    limit 1;

    if latest_closed_shift_id is null then
        raise exception 'No open shift or closed seed shift was found for CAFE_LI_BAR.';
    end if;

    update public.shifts
    set created_at = '2026-05-07T00:00:00Z'::timestamptz,
        shift_date = '2026-05-07'
    where id = latest_closed_shift_id;

    raise notice 'Updated latest closed shift % for CAFE_LI_BAR to 2026-05-07 so the next shift opens on 2026-05-08.', latest_closed_shift_id;
end $$;
