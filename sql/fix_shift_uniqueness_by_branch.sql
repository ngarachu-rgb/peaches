--------------------------------------------------------------------------------
-- Fix shift uniqueness so branches close independently
--
-- Why:
-- Older uniqueness rules blocked one branch from having the same
-- shift_date + shift_type as another branch under the same restaurant.
--
-- Correct rule:
--   restaurant_id + branch_id + shift_date + shift_type
--------------------------------------------------------------------------------

alter table public.shifts
drop constraint if exists unique_shift;

alter table public.shifts
drop constraint if exists unique_shift_per_day;

alter table public.shifts
drop constraint if exists shifts_unique_by_branch;

drop index if exists public.unique_shift;
drop index if exists public.unique_shift_per_day;
drop index if exists public.shifts_unique_by_branch;

alter table public.shifts
add constraint shifts_unique_by_branch
unique (restaurant_id, branch_id, shift_date, shift_type);
