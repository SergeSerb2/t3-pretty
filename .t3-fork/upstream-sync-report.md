# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261013.3053`
- Previously integrated parent nightly: `v0.0.46-nightly.20261013.3042`
- Conflict resolver: `gpt-6.1-sol` with `xhigh` reasoning
- 1 file(s) took the fork-side fallback because no model resolution was available; review their omissions below

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/features/pull-requests/PullRequestsScreen.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/src/features/threads/ComposerQueuedEdit.tsx` — Preserve the scenery-driven glass hook used by queued attachment chips, including the frosted-composer tint, glass-border hairline styling, and standard non-glass fallback.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Sent-image local bytes remain retained across the pending-to-confirmed message handoff and stay mounted over the server image until its load succeeds.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — The local overlay retains cover fitting, absolute positioning, rounded corners, and failure handling; pending attachments retain their layout placeholder and loading fallback.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Pending attachments still open their local preview, while confirmed attachments retain the resource-based gallery and presentation-source path.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Remote-image completion still updates Pretty's remoteLoaded state, and failed remote loads retain the guarded asset-URL refresh retry.
- `apps/server/src/git/GitManager.ts` — Retain pullRequestForBranch, including closed/merged PR results, mergedAt, and returned head associations even when no PR is found.
- `apps/server/src/git/GitManager.ts` — Retain saved head references, repository identities, owner-qualified selectors, and cross-repository preferred selectors rather than replacing them with current branch metadata.
- `apps/server/src/git/GitManager.ts` — Retain case-insensitive matching of saved repository identities to configured remotes and the explicit error when the saved repository is no longer configured.
- `apps/server/src/git/GitManager.ts` — Retain the bounded saved-association cache, success-only TTL, and cache keys containing the lookup epoch and head/target remote URL identities.
- `apps/server/src/git/GitManager.ts` — Retain ordinary lookups through branchPullRequest when no saved association is supplied, with the fork's existing response shaping.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — Terminal task-notification usage remains normalized and forwarded through the existing updateClaudeSubagentNode usage field, preserving final subagent usage totals alongside workflow telemetry.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — Existing opaque-background-task classification, wake reporting, roster updates, terminal outcome handling, and replay-tombstone cleanup remain unchanged.
- `apps/server/src/orchestration-v2/ProviderTurnControlService.ts` — Preserves t3ThreadMessageForProvider for the fork's provider-facing inter-thread messaging behavior.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/features/threads/ComposerQueuedEdit.tsx` — Import assetImageSource for the existing queued attachment preview call, which passes the environment ID, attachment resource, and resolved asset URL.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Remote attachments use ExpoImage with assetImageSource and memory-disk caching.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Attachment class names are resolved into an explicit image style, and ExpoImage uses contentFit="cover".
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — The ExpoImage load/error callbacks retain upstream's retry reset and guarded asset-URL refresh behavior. The local overlay also uses ExpoImage while preserving its fork-specific behavior.
- `apps/server/src/git/GitManager.ts` — Integrate the public branchPullRequest wrapper delegating to lookupBranchPullRequest with normalized cwd and optional freshness settings.
- `apps/server/src/git/GitManager.ts` — Make explicit refresh imply fresh Git state.
- `apps/server/src/git/GitManager.ts` — Recheck non-open PR results against fresh Git state when the initial lookup was not already fresh, while keeping the existing fast return for null, open, or already-fresh results.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — Unapplied outcomes for registered subagents discard earlier buffered starts on the same native thread, preventing stale starts from surviving a terminal notification.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — The cleanup receives the notification as its replay boundary, preserving later resumes, and retains the parent's guards against already-applied outcomes and unregistered tasks.
- `apps/server/src/orchestration-v2/ProviderTurnControlService.ts` — Integrates the type-only ProviderAdapter import required by the interrupt API's ProviderAdapterV2SubagentOutcome return type, supporting the parent's subagent-interruption contract.

## Parent changes intentionally omitted

- `apps/mobile/src/features/pull-requests/PullRequestsScreen.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: apps/mobile/src/features/pull-requests/PullRequestsScreen.tsx was not safe to resolve automatically: Unsafe to finalize. The edit preserves the fork's reachable Android controls and removes every supplied conflict marker, but it does not integrate the parent's connection-aware list filtering. Please supply the PullRequestsScreen caller that produces props.groups, the connectedTargets source, and the filterPullRequestList implementation/signature so the upstream change can be adapted to the native list architecture without guessing.
