begin;

--------------------------------------------------------------------------------
-- 1. Normalize profile roles to valid app roles
--------------------------------------------------------------------------------

update public.profiles
set role = case
    when role is null then role
    when lower(trim(role)) in ('supervisor', 'branch_supervisor') then 'supervisor'
    when lower(trim(role)) in ('admin', 'administrator', 'sys_admin', 'super_admin') then 'system_admin'
    when lower(trim(role)) in ('system_admin', 'developer', 'manager', 'supervisor', 'cashier', 'chef') then lower(trim(role))
    else role
end;

--------------------------------------------------------------------------------
-- 2. Ensure active flag is populated
--------------------------------------------------------------------------------

update public.profiles
set is_active = coalesce(is_active, true);

--------------------------------------------------------------------------------
-- 3. Constrain future invalid role values, while still allowing null temporarily
--------------------------------------------------------------------------------

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'profiles_role_valid_check'
    ) then
        alter table public.profiles
            add constraint profiles_role_valid_check
            check (
                role is null
                or role in ('developer', 'system_admin', 'manager', 'supervisor', 'cashier', 'chef')
            );
    end if;
exception
    when others then null;
end $$;

commit;
