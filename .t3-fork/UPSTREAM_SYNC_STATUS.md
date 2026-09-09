# Upstream Sync Typecheck Status

## Current Situation (as of commit 5382dea76)

### Problem with `tsconfig.upstream-sync.json` Exclude Approach

The initial approach of using `exclude` in tsconfig files **does not work** because:

1. TypeScript error **TS6307**: When non-excluded files import excluded files, TypeScript still errors
2. Example errors from `apps/web/tsconfig.upstream-sync.json`:
   ```
   src/components/Sidebar.tsx imports ./automations/AutomationDeleteDialog
   -> Error: AutomationDeleteDialog.tsx is not in file list (it's excluded)
   ```

### What Actually Needs Fixing

According to Buildkite #1747, **after merging `v0.0.39-nightly.20260907.1332`**, there are:
- **~207 web typecheck errors** in **non-excluded/shared files**
- Examples mentioned by user:
  - `apps/web/src/session-logic.ts`: missing imports for `ApprovalRequestId`, `PendingUserInput`, `ProviderDriverKind`
  - Missing symbols: `WorkspaceBreadcrumb*`, `ComposerCollapseTrigger`, `useSettings`

### Investigation Results

**On current main (with pendingRequests module):**
- `apps/web/src/session-logic.ts` **already has** those imports (lines 18-30)
- The constants `COMPOSER_*` and `MANAGED_PROJECT_FAVICON_*` were exported in commit 5382dea76
- **Without the upstream merge**, current codebase has no typecheck errors in these files

**This means:** The errors only appear AFTER merging the upstream nightly tag, likely due to:
- API changes in upstream that broke existing code
- Type renames/moves in contracts packages  
- New required properties/parameters

## Recommended Solution

### Option A: Merge-then-fix (Most Direct)

1. Merge `v0.0.39-nightly.20260907.1332` into this branch
2. Resolve 200+ merge conflicts (fork workflows, pendingRequests, etc.)
3. Fix the resulting 207 typecheck errors in non-fork files
4. Commit fixes
5. The `tsconfig.upstream-sync.json` files can then exclude fork-only paths safely

**Pros:** Fixes real errors that block upstream sync  
**Cons:** Requires resolving ~200 merge conflicts

### Option B: Cherry-pick fixes from `origin/cursor/fix-upstream-sync-typecheck-e8fd`

That branch has:
- Commit `a49c56c27`: Full merge of `v0.0.39-nightly.20260907.1332`
- Commit `0af1e2518`: Fixes for contracts (removes deleted types, adds missing constants)

Cherry-pick those commits onto this branch (conflicts expected but smaller scope).

**Pros:** Leverages existing fix work  
**Cons:** Still requires conflict resolution

### Option C: Stub Fork-Only Modules (Workaround)

Create minimal stub files for excluded fork-only modules that export enough types for non-fork code to compile.

**Pros:** Avoids upstream merge  
**Cons:** Hacky, doesn't fix real upstream sync issues, maintenance burden

## Current Branch State

- ✅ Exported missing `COMPOSER_*` constants in `packages/shared/src/composerTrigger.ts`
- ✅ Exported missing `MANAGED_PROJECT_FAVICON_*` constants in `packages/shared/src/projectFavicon.ts`  
- ✅ Created `tsconfig.upstream-sync.json` files (but they don't work due to TS6307)
- ⚠️ Need to either:
  - Merge upstream nightly and fix the 207 errors, OR
  - Remove the tsconfig files and take a different exclusion approach

## Next Steps

1. Decide on Option A or B above
2. If A: `git merge --no-ff v0.0.39-nightly.20260907.1332` and resolve conflicts
3. If B: `git cherry-pick a49c56c27 0af1e2518` and resolve conflicts
4. Run `pnpm exec tsc --noEmit -p apps/web/tsconfig.json` to see actual errors
5. Fix errors in non-fork files
6. Update `scripts/fork/run-upstream-sync.sh` to use working typecheck approach
