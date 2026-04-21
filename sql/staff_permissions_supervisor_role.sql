begin;

--------------------------------------------------------------------------------
-- Add supervisor role to profile validation and normalization
--------------------------------------------------------------------------------

update public.profiles
set role = case
    when role is null then role
    when lower(trim(role)) in ('supervisor', 'branch_supervisor') then 'supervisor'
    when lower(trim(role)) in ('admin', 'administrator', 'sys_admin', 'super_admin') then 'system_admin'
    when lower(trim(role)) in ('system_admin', 'developer', 'manager', 'cashier', 'chef') then lower(trim(role))
    else role
end;

alter table public.profiles
drop constraint if exists profiles_role_check;

alter table public.profiles
drop constraint if exists profiles_role_valid_check;

alter table public.profiles
add constraint profiles_role_check
check (
    role is null
    or role in ('developer', 'system_admin', 'manager', 'supervisor', 'cashier', 'chef')
);

commit;
