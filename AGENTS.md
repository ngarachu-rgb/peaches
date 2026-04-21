# AGENTS.md

## Project
Restaurant POS and Shift Management System using Supabase.

## Business rules
- Each shift must close cleanly before the next shift opens.
- Previous shift closing stock becomes next shift opening stock for matching items.
- Previous shift cash carried forward becomes next shift cash brought forward.
- Sold quantity formula:
  sold_qty = opening_qty + produced_qty + received_qty - closing_qty - transferred_out_qty + transferred_in_qty
- Reverse dispatch must never be duplicated or double-applied.
- All monetary totals must reconcile at shift close.
- Every record must belong to a branch_id.
- Branch data must be isolated by branch_id in all reads and writes.
- Support single-branch now, but structure code for multi-branch scaling.

## Technical rules
- Use async/await consistently.
- No duplicate functions or conflicting globals.
- Keep UI logic separate from business logic and database access.
- Prefer modular files over one large script block.
- Validate all required form inputs before submit.
- Every form field should have id and name.
- No console errors.
- Fail loudly with readable error messages.
- Preserve existing UI behavior unless task explicitly says to change it.

## Supabase rules
- Supabase is the source of truth.
- Use explicit column names; do not rely on implicit object shapes.
- Wrap multi-step closing/opening flows in safe ordered logic.
- Check for and handle null, undefined, and empty result sets.
- Do not overwrite data for another branch.
- Prepare database access patterns so row-level security can be added cleanly later.

## Testing expectations
- After changes, review for broken buttons, undefined functions, and duplicate handlers.
- Test shift open, sales entry, dispatch, reverse dispatch, shift close, and next shift open.
- Verify stock carry-forward and cash carry-forward.
- Verify branch filtering on all screens and queries.