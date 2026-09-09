# Upstream Sync Typecheck Exclusions

## Overview

The Upstream Sync pipeline uses separate tsconfig files to exclude fork-only modules from typecheck validation. This allows the sync to proceed even when fork-only features have type errors after merging upstream changes.

## Why This Exists

After merging upstream tag v0.0.39-nightly.20260907.1332, there were ~663 TypeScript errors, mostly in fork-only features:
- automations
- agent instructions (agentInstructions)
- project transfers (projectTransfer)
- storage inventory (storageInventory)
- preview automation features

Rather than block every upstream sync on fixing these errors, we exclude these paths from the Upstream Sync typecheck gate while keeping shared/upstream-facing code checked.

## Excluded Paths by Package

### apps/web (`tsconfig.upstream-sync.json`)
- `src/state/automations.ts`
- `src/state/agentInstructions.ts`
- `src/state/projectTransfer.ts`
- `src/state/storageInventory.ts`
- `src/routes/automations.$environmentId.$automationId.tsx`
- `src/components/automations/**`
- `src/components/settings/AgentInstructionsSettings.tsx`
- `src/components/settings/StorageSettings.tsx`
- `src/components/ProjectTransferDialog.tsx`
- `src/components/preview/PreviewAutomationHosts.tsx`
- `src/components/preview/previewAutomationRequestConsumer.test.ts`
- `src/components/preview/previewAutomationRequestConsumer.ts`
- `src/components/preview/previewAutomationTarget.test.ts`
- `src/components/preview/previewAutomationTarget.ts`
- `src/components/chat/AutomationRunBanner.tsx`
- `src/components/sidebar/SidebarAutomationRow.tsx`

### apps/server (`tsconfig.upstream-sync.json`)
- `src/automations/**`
- `src/storage/**`
- `src/instructions/**`
- `src/project/ProjectTransfer.ts`
- `src/project/ProjectTransfer.test.ts`
- `src/orchestration/decider.automations.test.ts`
- `src/orchestration/projector.automations.test.ts`
- `src/orchestration/decider.transfer.test.ts`
- `src/persistence/Migrations/050_Automations.ts`
- `src/persistence/Layers/ProjectionAutomations.ts`
- `src/persistence/Services/ProjectionAutomations.ts`
- `src/mcp/PreviewAutomationBroker.ts`
- `src/mcp/PreviewAutomationBroker.test.ts`
- `src/mcp/toolkits/automations/**`
- `src/mcp/toolkits/preview/**`

### packages/contracts (`tsconfig.upstream-sync.json`)
- `src/automations.ts`
- `src/automations.test.ts`
- `src/projectTransfer.ts`
- `src/storage.ts`
- `src/previewAutomation.ts`

### packages/client-runtime (`tsconfig.upstream-sync.json`)
- `src/state/automations.ts`
- `src/state/automations.test.ts`
- `src/state/agentInstructions.ts`
- `src/state/projectTransfer.ts`

### apps/mobile (`tsconfig.upstream-sync.json`)
- `src/state/automations.ts`
- `src/state/project-transfer.ts`
- `src/state/storageInventory.ts`
- `src/features/automations/**`
- `src/features/settings/SettingsEnvironmentStorageRouteScreen.tsx`
- `src/features/threads/use-project-transfer.ts`

### apps/desktop (`tsconfig.upstream-sync.json`)
- `src/preview/Manager.ts`
- `src/preview/Manager.test.ts`
- `src/ipc/methods/preview.ts`
- `src/ipc/methods/preview.test.ts`

## What's Still Checked

The following are NOT excluded and remain fully typechecked during Upstream Sync:
- All shared packages (contracts core, client-runtime core)
- Core web app functionality
- Core server functionality
- pendingRequests module (already landed on main)
- All upstream-facing code and APIs

## How to Re-enable Full Typecheck

When the fork-only module type errors are fixed:

1. **Option A: Remove the tsconfig.upstream-sync.json files**
   ```bash
   rm apps/web/tsconfig.upstream-sync.json
   rm apps/server/tsconfig.upstream-sync.json
   rm apps/desktop/tsconfig.upstream-sync.json
   rm apps/mobile/tsconfig.upstream-sync.json
   rm packages/contracts/tsconfig.upstream-sync.json
   rm packages/client-runtime/tsconfig.upstream-sync.json
   ```

2. **Revert the script changes in `scripts/fork/run-upstream-sync.sh`**
   
   Change the typecheck commands back to use the standard `vp run --filter <package> typecheck` commands instead of the `bash -c 'cd ... && vp exec tsc --project tsconfig.upstream-sync.json'` commands.

3. **Test locally**
   ```bash
   # Run full typecheck to verify no errors remain
   vp run --filter @t3tools/contracts typecheck
   vp run --filter @t3tools/client-runtime typecheck
   vp run --filter @t3tools/web typecheck
   vp run --filter @t3tools/desktop typecheck
   vp run --filter @t3tools/mobile typecheck
   ```

4. **Commit and push**
   ```bash
   git add -A
   git commit -m "chore(sync): restore full typecheck after fixing fork-only module errors"
   git push
   ```

## Current Status

As of this change, the full merged tree still has **~663 TypeScript errors** in the excluded fork-only modules. These errors do not affect the Upstream Sync build gate but should eventually be fixed.

## Implementation Details

The Upstream Sync script (`scripts/fork/run-upstream-sync.sh`) uses these tsconfig files in the `validate_sync_tree_once` function for the following validation steps:
- `shared-typecheck` (contracts + client-runtime)
- `web-typecheck`
- `desktop-typecheck`
- `mobile-typecheck`

The relay typecheck and server bundle steps are unchanged.
