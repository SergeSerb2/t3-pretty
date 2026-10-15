# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261014.3132`
- Previously integrated parent nightly: `v0.0.46-nightly.20261014.3118`
- Conflict resolver: `gpt-6.1-sol` with `xhigh` reasoning
- 2 file(s) took the fork-side fallback because no model resolution was available; review their omissions below

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/features/pull-requests/PullRequestsScreen.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/src/features/threads/threadListV2.ts` — Retain backgroundLiveness in the status resolver’s input contract, keeping background working and monitoring statuses reachable.
- `apps/mobile/src/features/threads/threadListV2.ts` — Retain pullRequests in the status resolver’s input contract, preserving the merged-PR Done status and its existing precedence.
- `apps/server/src/provider/Drivers/ClaudeHome.ts` — The shared claude:portable-transcripts continuation group remains exported, preserving cross-account and cross-instance continuation rather than partitioning threads by config directory.
- `apps/server/src/provider/Drivers/ClaudeHome.ts` — importClaudeSessionTranscript remains unchanged and exported: it copies the latest session transcript between config directories using the CLI-written project slug.
- `apps/server/src/provider/Drivers/ClaudeHome.ts` — Optional subagent/tool-result sidecars are replaced rather than merged, including removal of stale target sidecars when the source has none. The same logic supports switching back to a previously used account without reviving stale data.
- `apps/server/src/provider/Drivers/ClaudeHome.ts` — Same-directory and missing-transcript no-op behavior remains intact.
- `apps/web/src/components/ChatMarkdown.tsx` — Mermaid framing and wrapping remain controlled by each block's diagram argument, so the Suspense diagram placeholder retains diagram presentation with wrapping disabled even when deferred showDiagram differs.
- `apps/web/src/components/ChatMarkdown.tsx` — Preserve deferred diagram rendering, source/diagram toggling in both directions, and the existing Find source-reveal wiring.
- `apps/web/src/components/ChatView.tsx` — Preserves T3 Pretty's removal of the useThreadActions import while retaining useAcknowledgeThreadWoke from its existing module.
- `apps/web/src/components/Sidebar.logic.ts` — Retains optional backgroundLiveness input, keeping T3 Pretty's existing background working and monitoring status branches reachable without requiring callers to supply background liveness.
- `apps/web/src/components/Sidebar.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/state/pullRequests.ts` — Retains useRetryInterruptedQuery, preserving the dependency for T3 Pretty’s interrupted pull-request query retry behavior rather than reverting to the base error-formatter import.
- `packages/client-runtime/src/state/threadSettled.ts` — Retains Pretty's explicit distinction between snoozed classification and persisted lifecycle state, including the relationship to blocked work and effectiveSettled. No runtime or lifecycle logic is changed.
- `packages/client-runtime/src/state/threadShell.ts` — Retains SupervisorConnectionState and the generic &lt;E&gt; factory signature, preserving Pretty’s typed connection-state atom contract supporting disconnected-environment thread filtering.
- `packages/client-runtime/src/state/threadShell.ts` — Retains isAutomationRunThread for Pretty’s existing automation-run thread handling.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/features/threads/threadListV2.ts` — Include pendingSubagentRequest in the status resolver’s input contract so the parent’s subagent approval and user-input status checks remain type-correct and take priority over runtime and background statuses.
- `apps/server/src/provider/Drivers/ClaudeHome.ts` — Added hasClaudeManagedMcpConfig with upstream's macOS, Windows, and Linux managed-mcp.json paths, exposing the detection needed by callers handling incompatibility with --strict-mcp-config.
- `apps/server/src/provider/Drivers/ClaudeHome.ts` — Preserved upstream's filesystem-error fallback to false when checking for managed MCP configuration.
- `apps/web/src/components/ChatMarkdown.tsx` — Adopt the leadingActions-to-viewToggle API change, keeping the Mermaid toggle connected to the updated code-block actions toolbar.
- `apps/web/src/components/ChatView.tsx` — Adds the parent's childThreadInputsTitle import from @t3tools/client-runtime/state/threads.
- `apps/web/src/components/Sidebar.logic.ts` — Adds pendingSubagentRequest to the status resolver input type, supporting the existing subagent approval and user-input checks and their precedence over runtime and background statuses.
- `apps/web/src/state/pullRequests.ts` — Adds the parent’s environmentThreadShells import from ./threads.
- `packages/client-runtime/src/state/threadSettled.ts` — Documents that a blocked subagent, as well as the main agent, raises a snoozed thread's hand, matching the existing pendingSubagentRequest check.
- `packages/client-runtime/src/state/threadShell.ts` — Adds PendingSubagentRequest to the model type imports.
- `packages/client-runtime/src/state/threadShell.ts` — Adds live-subagent request classification, excluding auth-refresh requests, provider-native subagents, and ended runs while distinguishing user input from approvals.
- `packages/client-runtime/src/state/threadShell.ts` — Adds ancestor request propagation with cycle protection, approval precedence, and shared empty-map reuse.
- `packages/client-runtime/src/state/threadShell.ts` — Adds singular/plural child-input banner titles that distinguish input, approval, and mixed requests.

## Parent changes intentionally omitted

- `apps/mobile/src/features/pull-requests/PullRequestsScreen.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: apps/mobile/src/features/pull-requests/PullRequestsScreen.tsx was not safe to resolve automatically: Cannot produce a coherent merge with high confidence from this excerpt. Supply the remainder of apps/mobile/src/features/pull-requests/PullRequestsScreen.tsx, the fork code that owns usePullRequestListControls and PR request-target construction, and the definitions of withoutScratchProjectScope and useProjects. That context is needed to apply the compatible scratch-scope fix consistently to requests, displayed selection, and restored filters without regressing Pretty’s native PR interface. No search-and-replace edits are proposed; the conflicts remain unresolved.
- `apps/server/src/provider/Drivers/ClaudeHome.ts` — The home-directory-scoped makeClaudeContinuationGroupKey implementation present in THEIRS, unchanged from BASE, is not reinstated.. Reason: OURS deliberately replaced this partitioning with a shared portable-transcript continuation group. Restoring per-home grouping would regress the fork's ability to continue the same thread across Claude accounts; managed-MCP detection does not require it.
- `apps/web/src/components/Sidebar.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: apps/web/src/components/Sidebar.tsx was not safe to resolve automatically: Cannot validate a coherent merge with high confidence. BASE imports legacyProjectCwdPreferenceKey; OURS retains it while adding project-folder helpers and resolveProjectExpanded; THEIRS removes it. Please provide the remaining project-expansion reads and toggle handlers in apps/web/src/components/Sidebar.tsx and the exports/implementations of legacyProjectCwdPreferenceKey and resolveProjectExpanded in apps/web/src/uiStateStore. The supplied edit removes all conflict markers provisionally, but must not be treated as safe or applied as a completed resolution without that context.

## Post-merge repairs

- `shared-typecheck` failed after merging `v0.0.46-nightly.20261014.3132`; repaired with `gpt-6.1-sol`: Adapt T3 Pretty’s all-thread shell atom to the three-argument scopedThread API by subscribing to and forwarding pending subagent requests. This fixes the reported type error while preserving disconnected-environment filtering and access to automation run threads.
  - edited `packages/client-runtime/src/state/threadShell.ts`
