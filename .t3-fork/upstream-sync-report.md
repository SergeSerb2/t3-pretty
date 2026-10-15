# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261015.3145`
- Previously integrated parent nightly: `v0.0.46-nightly.20261014.3132`
- Conflict resolver: `gpt-6.1-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/components/AppSymbol.tsx` — Preserves T3 Pretty's circle.lefthalf.filled → IconCircleHalf2 mapping and its half-filled-circle rendering on Android.
- `apps/mobile/src/features/pull-requests/PullRequestRouteScreen.tsx` — Retains copyTextWithHaptic for the fork’s haptic-aware copy interactions instead of restoring direct expo-clipboard access.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Retained the monitoring status key and Monitoring label.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Retained foreground text and the adaptive zinc pill, consistent with the local pill-based status presentation contract.
- `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts` — Retain MCP configuration generated from every entry in mcpSession.servers, preserving each server's name and URL rather than reverting to a single hard-coded t3-code endpoint.
- `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts` — Retain the session Authorization header on every configured MCP server.
- `apps/web/src/components/Sidebar.tsx` — Keep resolveSidebarThreadTopStatus authoritative for status visibility, labels, colors, and merged-pull-request, wake, and unread handling.
- `apps/web/src/components/Sidebar.tsx` — Preserve the Goal label for working threads with an active goal.
- `apps/web/src/components/Sidebar.tsx` — Keep the keyed in-place title/status transition hooks and existing shared-pulse and subscription-lease wiring intact; introduce no continuous label animation.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Preserve the exported pullRequestDiffIdentity helper and its additions/deletions/changedFiles identity, allowing existing consumers to avoid rebuilding the code tab for comment, check, or review-state updates alone.
- `apps/web/src/components/settings/StorageSettings.tsx` — The StorageCleanupPolicySections component boundary, rather than reverting the fork's component split to the base StorageSettingsPanel declaration.
- `apps/web/src/components/settings/StorageSettings.tsx` — Environment-specific pending storage actions carrying both inventory and action data.
- `apps/web/src/components/settings/StorageSettings.tsx` — Storage refresh interaction, accessible label, pending-state disabling, and existing useStatusPulse wiring with the pulse class applied only while pending.
- `apps/web/src/components/settings/StorageSettings.tsx` — Managed-worktree usage visualization and legend, including active, archived, and orphan categories, byte totals, tooltips, and clean/dirty/unknown indicators.
- `apps/web/src/components/settings/StorageSettings.tsx` — Selectable storage device cards with selected-state styling, aria-pressed, selection handlers, connection-phase status indicators, and device-specific icons and descriptions.
- `apps/web/src/components/settings/StorageSettings.tsx` — Surge Connect branding for relay connections and distinct primary, SSH, desktop-local, and remote device presentation.
- `apps/web/src/lib/openPullRequestLink.test.ts` — Regression coverage for Origin pull-request URLs on cursor.com, www.cursor.com, and origin.cursor.com, canonicalized to origin.cursor.com.
- `apps/web/src/lib/openPullRequestLink.test.ts` — Assertions preserving lowercase repository identity, the pull-request number, and support for the Origin /files suffix.
- `apps/web/src/lib/openPullRequestLink.test.ts` — All three fork-added rejection cases for incomplete or unrelated Cursor URLs, protecting browser fallback rather than incorrectly claiming them as pull requests.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/components/AppSymbol.tsx` — Adds the parent's circle.dashed.inset.filled → IconCircleDot mapping using the existing icon component.
- `apps/mobile/src/features/pull-requests/PullRequestRouteScreen.tsx` — Adds canPerformPullRequestAction, PR_ACTION_ICONS, and PR_ACTION_LABELS imports for upstream action capability checks and shared action presentation, while retaining openOnProviderLabel.
- `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts` — Use CODEX_T3_MCP_TOOL_TIMEOUT_SEC (65 minutes) instead of the previous 660-second timeout, allowing hour-long T3 wait tools to finish under their own timeout.
- `apps/web/src/components/Sidebar.tsx` — Apply the parent's explicit waiting icon to resolved waiting statuses, retaining the fork's helper-derived label and styling and passing the icon through the existing status-change hook.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Add canDeletePullRequestBranch unchanged: deletion requires a non-open pull request, explicit deleteBranch capability, and delete-branch in both host capabilities and viewer permissions.
- `apps/web/src/components/settings/StorageSettings.tsx` — Added environments to the useSettingsScope destructuring in the fork's cleanup-policy component, preserving the parent's scope API addition alongside connectedEnvironments, targets, target, and scope.
- `apps/web/src/lib/openPullRequestLink.test.ts` — Removal from this file of the unchanged base parser tests for GitHub, GitHub Enterprise, GitLab, Bitbucket, Azure DevOps, generic suffix handling, and generic invalid references.

## Parent changes intentionally omitted

- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Replace the Waiting status icon from clock with circle.dashed.inset.filled.. Reason: T3 Pretty deliberately replaced this base entry with Monitoring and a themed pill. The supplied STATUS_BY_BADGE contract has pill fields, not icon fields. Restoring the parent's entry would remove the fork's Monitoring presentation; adding an unused icon would not integrate observable behavior.
- `apps/web/src/lib/openPullRequestLink.test.ts` — Complete removal of the parseChangeRequestUrl test block.. Reason: A minimal Origin-only block remains because OURS added regression assertions absent from BASE, and the supplied context shows no equivalent replacement coverage for those fork-specific cases.

## Post-merge repairs

- `shared-typecheck` failed after merging `v0.0.46-nightly.20261015.3145`; repaired with `gpt-6.1-sol`: Update both metadata-only orchestration test runtime types to include the API's newly required HttpClient service. Preserve all retention and shell-resume assertions, production behavior, and upstream additions.
  - edited `packages/client-runtime/src/state/orchestration.test.ts`
- `shared-typecheck` failed after merging `v0.0.46-nightly.20261015.3145`; repaired with `gpt-6.1-sol`: Correct the obsolete HTTP type import without changing runtime service requirements or any T3 Pretty retention and shell-resume tests. Leave non-error diagnostics untouched.
  - edited `packages/client-runtime/src/state/orchestration.test.ts`
- `server-typecheck` failed after merging `v0.0.46-nightly.20261015.3145`; repaired with `gpt-6.1-sol`: Fix TS1117 by removing the conflicting duplicate timeout entry from the Codex process-spawning fixture. Preserve T3 Pretty's 660-second timeout, upstream's MCP startup grace setting, and the complete test.
  - edited `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.test.ts`
  - omitted parent change: The 3,900-second tool_timeout_sec expectation in the Codex MCP process-spawning fixture.. Reason: It conflicts with T3 Pretty's authoritative 660-second timeout for the same server. Keep the Pretty value; the test and all other upstream configuration remain intact.
