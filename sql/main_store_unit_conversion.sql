begin;

--------------------------------------------------------------------------------
-- Atomic main-store unit conversion with an immutable audit trail.
--
-- Stock is stored in store units. When the store unit changes and the buying
-- unit stays the same, the equivalent balance is:
--   new stock = old stock / old conversion factor * new conversion factor
--------------------------------------------------------------------------------

create extension if not exists pgcrypto;

create table if not exists public.stock_unit_conversions (
    id uuid primary key default gen_random_uuid(),
    restaurant_id uuid not null references public.restaurants(id) on delete restrict,
    branch_id uuid not null references public.branches(id) on delete restrict,
    material_id uuid not null references public.main_store(id) on delete restrict,
    material_name text not null,
    old_buy_unit text not null,
    old_store_unit text not null,
    old_conversion_factor numeric not null check (old_conversion_factor > 0),
    old_stock_level numeric not null,
    old_current_stock numeric not null,
    new_buy_unit text not null,
    new_store_unit text not null,
    new_conversion_factor numeric not null check (new_conversion_factor > 0),
    new_stock_level numeric not null,
    new_current_stock numeric not null,
    reason text not null check (length(trim(reason)) > 0),
    changed_by_user_id uuid,
    changed_by text not null,
    created_at timestamptz not null default now()
);

create index if not exists idx_stock_unit_conversions_branch_created
    on public.stock_unit_conversions (branch_id, created_at desc);

create index if not exists idx_stock_unit_conversions_material_created
    on public.stock_unit_conversions (material_id, created_at desc);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'main_store_same_unit_factor_check'
          and conrelid = 'public.main_store'::regclass
    ) then
        alter table public.main_store
            add constraint main_store_same_unit_factor_check
            check (
                lower(trim(coalesce(buy_unit, ''))) <> lower(trim(coalesce(store_unit, '')))
                or conversion_factor = 1
            ) not valid;
    end if;
end
$$;

alter table public.stock_unit_conversions enable row level security;

drop policy if exists "stock_unit_conversions_select_same_restaurant" on public.stock_unit_conversions;
create policy "stock_unit_conversions_select_same_restaurant"
on public.stock_unit_conversions
for select
to authenticated
using (restaurant_id = public.current_user_restaurant_id());

revoke insert, update, delete on public.stock_unit_conversions from anon, authenticated;
grant select on public.stock_unit_conversions to authenticated;

create or replace function public.guard_main_store_unit_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_unit_settings_changed boolean;
begin
    v_unit_settings_changed :=
        lower(trim(coalesce(old.buy_unit, ''))) <> lower(trim(coalesce(new.buy_unit, '')))
        or lower(trim(coalesce(old.store_unit, ''))) <> lower(trim(coalesce(new.store_unit, '')))
        or old.conversion_factor is distinct from new.conversion_factor;

    if v_unit_settings_changed
       and coalesce(current_setting('pos.unit_conversion_authorized', true), '') <> 'true' then
        raise exception
            'Unit settings must be changed through update_main_store_units_with_stock_conversion so stock is converted and audited.';
    end if;

    return new;
end;
$$;

drop trigger if exists guard_main_store_unit_settings_trigger on public.main_store;
create trigger guard_main_store_unit_settings_trigger
before update of buy_unit, store_unit, conversion_factor
on public.main_store
for each row
execute function public.guard_main_store_unit_settings();

create or replace function public.update_main_store_units_with_stock_conversion(
    p_material_id uuid,
    p_restaurant_id uuid,
    p_branch_id uuid,
    p_name text,
    p_buy_unit text,
    p_store_unit text,
    p_conversion_factor numeric,
    p_price numeric,
    p_reorder_level numeric,
    p_is_key_shift_item boolean,
    p_reason text,
    p_changed_by text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_profile public.profiles%rowtype;
    v_material public.main_store%rowtype;
    v_settings_changed boolean;
    v_store_unit_changed boolean;
    v_buy_unit_changed boolean;
    v_old_stock numeric;
    v_old_current_stock numeric;
    v_new_stock numeric;
    v_updated jsonb;
begin
    select *
    into v_profile
    from public.profiles
    where id = auth.uid();

    if v_profile.id is null
       or not coalesce(v_profile.is_active, false)
       or v_profile.restaurant_id is distinct from p_restaurant_id
       or lower(trim(coalesce(v_profile.role, ''))) not in ('developer', 'system_admin', 'manager') then
        raise exception 'You are not authorized to change stock unit settings.';
    end if;

    if p_branch_id is null then
        raise exception 'Branch is required for a stock unit conversion.';
    end if;
    if nullif(trim(coalesce(p_name, '')), '') is null then
        raise exception 'Material name is required.';
    end if;
    if nullif(trim(coalesce(p_buy_unit, '')), '') is null
       or nullif(trim(coalesce(p_store_unit, '')), '') is null then
        raise exception 'Buying unit and store unit are required.';
    end if;
    if p_conversion_factor is null or p_conversion_factor <= 0 then
        raise exception 'Conversion factor must be greater than zero.';
    end if;
    if lower(trim(p_buy_unit)) = lower(trim(p_store_unit))
       and p_conversion_factor <> 1 then
        raise exception 'Conversion factor must be 1 when buying unit and store unit are the same.';
    end if;

    select *
    into v_material
    from public.main_store
    where id = p_material_id
      and restaurant_id = p_restaurant_id
      and branch_id = p_branch_id
    for update;

    if v_material.id is null then
        raise exception 'The branch stock item was not found.';
    end if;
    if nullif(trim(coalesce(v_material.buy_unit, '')), '') is null
       or nullif(trim(coalesce(v_material.store_unit, '')), '') is null then
        raise exception 'The existing buying unit or store unit is missing and must be repaired manually.';
    end if;
    if coalesce(v_material.conversion_factor, 0) <= 0 then
        raise exception 'The existing conversion factor is invalid and must be repaired manually before conversion.';
    end if;

    v_buy_unit_changed := lower(trim(coalesce(v_material.buy_unit, ''))) <> lower(trim(p_buy_unit));
    v_store_unit_changed := lower(trim(coalesce(v_material.store_unit, ''))) <> lower(trim(p_store_unit));
    v_settings_changed := v_buy_unit_changed
        or v_store_unit_changed
        or v_material.conversion_factor <> p_conversion_factor;

    v_old_stock := coalesce(v_material.stock_level, v_material.current_stock, 0);
    v_old_current_stock := coalesce(v_material.current_stock, v_material.stock_level, 0);

    if v_settings_changed and nullif(trim(coalesce(p_reason, '')), '') is null then
        raise exception 'A reason is required when changing unit settings.';
    end if;

    if v_store_unit_changed and v_buy_unit_changed and (v_old_stock <> 0 or v_old_current_stock <> 0) then
        raise exception 'Buying unit and store unit cannot both change while stock is non-zero.';
    end if;

    if v_store_unit_changed then
        v_new_stock := (v_old_stock / v_material.conversion_factor) * p_conversion_factor;
    else
        -- Stock is already expressed in the unchanged store unit. A packaging
        -- conversion-factor correction must not change the physical balance.
        v_new_stock := v_old_stock;
    end if;

    if v_new_stock < 0 then
        raise exception 'Converted stock cannot be negative.';
    end if;

    perform set_config('pos.unit_conversion_authorized', 'true', true);

    update public.main_store
    set
        name = trim(p_name),
        buy_unit = trim(p_buy_unit),
        store_unit = trim(p_store_unit),
        conversion_factor = p_conversion_factor,
        price = p_price,
        reorder_level = coalesce(p_reorder_level, 0),
        is_key_shift_item = coalesce(p_is_key_shift_item, false),
        stock_level = v_new_stock,
        current_stock = v_new_stock
    where id = v_material.id
      and restaurant_id = p_restaurant_id
      and branch_id = p_branch_id
    returning to_jsonb(main_store) into v_updated;

    if v_settings_changed then
        insert into public.stock_unit_conversions (
            restaurant_id,
            branch_id,
            material_id,
            material_name,
            old_buy_unit,
            old_store_unit,
            old_conversion_factor,
            old_stock_level,
            old_current_stock,
            new_buy_unit,
            new_store_unit,
            new_conversion_factor,
            new_stock_level,
            new_current_stock,
            reason,
            changed_by_user_id,
            changed_by
        ) values (
            p_restaurant_id,
            p_branch_id,
            v_material.id,
            trim(p_name),
            v_material.buy_unit,
            v_material.store_unit,
            v_material.conversion_factor,
            v_old_stock,
            v_old_current_stock,
            trim(p_buy_unit),
            trim(p_store_unit),
            p_conversion_factor,
            v_new_stock,
            v_new_stock,
            trim(p_reason),
            auth.uid(),
            coalesce(nullif(trim(p_changed_by), ''), auth.uid()::text)
        );
    end if;

    return jsonb_build_object(
        'material', v_updated,
        'unit_settings_changed', v_settings_changed,
        'stock_converted', v_store_unit_changed,
        'old_stock_level', v_old_stock,
        'new_stock_level', v_new_stock
    );
end;
$$;

revoke all on function public.update_main_store_units_with_stock_conversion(
    uuid, uuid, uuid, text, text, text, numeric, numeric, numeric, boolean, text, text
) from public, anon;

grant execute on function public.update_main_store_units_with_stock_conversion(
    uuid, uuid, uuid, text, text, text, numeric, numeric, numeric, boolean, text, text
) to authenticated;

commit;
