# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261013.3080`
- Previously integrated parent nightly: `v0.0.46-nightly.20261013.3066`
- Conflict resolver: `gpt-6.1-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/onboarding/WelcomeWizard.tsx` — kept T3 Pretty's intentional deletion of this file
- `apps/desktop/scripts/electron-launcher.mjs` — Development macOS launcher icon remains assets/pretty/t3-pretty-1024.png.
- `apps/desktop/scripts/electron-launcher.mjs` — Production macOS launcher icon remains assets/pretty/t3-pretty-1024.png.
- `apps/desktop/scripts/electron-launcher.mjs` — Existing T3 Pretty development and production display names remain unchanged.
- `apps/mobile/src/features/threads/ThreadRouteScreen.tsx` — Thread-specific World Scenery remains mounted inside ThreadPane through the routeThreadIdentity-keyed SceneryBackdrop.
- `apps/mobile/src/features/threads/ThreadRouteScreen.tsx` — The environment/thread-scoped ThreadDetailRenderBoundary and both routeVisible props remain intact, preserving visibility-controlled presentation work for retained thread screens.
- `apps/mobile/src/features/threads/ThreadRouteScreen.tsx` — Generated live activity headlines remain connected through liveHeadline={composer.liveTurnHeadline}.
- `apps/mobile/src/features/threads/ThreadRouteScreen.tsx` — Agent secret/API-key requests retain their active request, responding request ID, and response-handler wiring to ThreadDetailScreen.
- `apps/mobile/src/features/threads/ThreadRouteScreen.tsx` — Automatic content insets continue to follow TRANSPARENT_NATIVE_HEADERS, preserving Pretty's transparent-header and scenery layout behavior.
- `apps/server/src/persistence/Migrations.ts` — All existing migration IDs, names, and bindings through ID 75 remain unchanged, preserving Pretty's shipped migration ledger and execution order.
- `apps/server/src/persistence/Migrations.ts` — Branch pull-request repair, orchestration event recorded-at data, and thread branch-head persistence remain registered at IDs 50–52.
- `apps/server/src/persistence/Migrations.ts` — World Scenery and Thread Canvas persistence remain registered at IDs 53–54.
- `apps/server/src/persistence/Migrations.ts` — Activity compaction metadata and superseded tool-update activity cleanup remain registered at IDs 55 and 57.
- `apps/server/src/persistence/Migrations.ts` — Enabled skill IDs and subagent policy persistence remain registered at IDs 56 and 58.
- `apps/server/src/persistence/Migrations.ts` — The thread search index supporting the fork's BM25 search remains registered at ID 59.
- `apps/server/src/persistence/Migrations.ts` — Automations, automation command receipts, and the webhook dispatch outbox remain registered at IDs 60, 69, and 72.
- `apps/server/src/persistence/Migrations.ts` — Stored-thread persistence and auto-settle-disabled state remain registered at IDs 66 and 65.
- `apps/server/src/persistence/Migrations.ts` — Previously integrated parent migrations remain wired under Pretty's existing IDs, including message context at 62, title state at 63, Orchestration V2 at 67, and the subsequent webhook, MCP, snapshot-index, and review-guide migrations.
- `apps/server/src/persistence/Sqlite.ts` — Streaming-write performance tuning: synchronous=NORMAL, a 4000-page WAL autocheckpoint threshold, and a 64 MiB page cache.
- `apps/server/src/persistence/Sqlite.ts` — Migration-result tracking and the idempotent branch/pull-request column repair for databases affected by fork migration-slot collisions.
- `apps/server/src/persistence/Sqlite.ts` — Migration-gated, batched cleanup of superseded tool-progress rows before serving requests, with deletion logging, VACUUM, and best-effort failure handling.
- `apps/server/src/persistence/Sqlite.ts` — Clean-shutdown planner-statistics refresh before the SQLite client closes, with errors ignored.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — T3 Pretty migration-history identity and upgrade coverage that leaves shipped ledger entries through migration 69 unchanged.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Rejection of conflicting upstream OrchestrationV2 preview IDs 53 and 54 without modifying the ledger or legacy-import progress.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Transactional schema-and-ledger rollback, successful retry, and subsequent no-op migration runs.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — Fork migration IDs 70–72 for ScheduledTaskWebhooks, WebhookRelayDeliveries, and WebhookDispatchOutbox, plus existing manifest-driven expectations for later migrations.
- `apps/web/src/components/ChatView.tsx` — Retain draftModelByInstance and its reactive subscription to the complete per-provider model-selection map.
- `apps/web/src/components/ChatView.tsx` — Retain composerHasUnsentContent and its composerDraftHasUserContent-based subscription, without narrowing detection to prompt text or attachments.
- `apps/web/src/components/ChatView.tsx` — Keep both fork subscriptions scoped to composerDraftTarget, including the separate target used when editing a queued run.
- `apps/web/src/components/ChatView.tsx` — Timeline render-error containment, renderer error reporting, reset on displayed-thread or entry-count changes, and the themed plain-message fallback with its data-timeline-error attribute.
- `apps/web/src/components/ChatView.tsx` — The existing single mounted MessagesTimeline and its worktreeSetupExiting prop, preserving the fork's worktree-panel exit-animation wiring.
- `apps/web/src/components/ChatView.tsx` — The liveHeadline consumer remains connected to liveTurnHeadline, with paint-only suppression, preserving generated live activity headlines.
- `apps/web/src/components/ChatView.tsx` — Cached and held remote-thread rendering retains displayed-thread identity, environment-specific providers, held workspace context, and paint-only guards. Existing citation, related-thread, fork, rollback, attachment, artifact, theme, anchor, and live-follow wiring remains intact.

## Parent changes integrated at conflict boundaries

- `apps/desktop/scripts/electron-launcher.mjs` — LAUNCHER_VERSION increases from 19 to 20.
- `apps/mobile/src/features/threads/ThreadRouteScreen.tsx` — Forward composer.pendingHandoff to ThreadDetailScreen within Pretty's existing render boundary, incorporating the sole THEIRS-versus-BASE change in this conflict.
- `apps/server/src/persistence/Migrations.ts` — Import and register the new 062_ThreadFailureLookupIndex.ts migration. Its manifest ID is adapted from parent ID 62 to Pretty's next free ID 76, allowing the existing startup runner to execute it after all previously shipped migrations.
- `apps/server/src/persistence/Sqlite.ts` — Startup PRAGMA optimize = 0x10012 to refresh planner statistics for indexes lacking statistics or tables with substantial row-count changes, executed after migrations, compatibility repair, and any cleanup.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — ThreadFailureLookupIndex migration coverage, adapted to the fork's manifest-assigned ID rather than parent ID 62.
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — An exactly-once manifest assertion and inclusion of ThreadFailureLookupIndex in the successful rollback/retry migration list; the upgrade test also retains full-history comparison against the manifest.
- `apps/web/src/components/ChatView.tsx` — Add composerSelectedModelSelection as a reactive subscription to the current draft's active-provider model selection, preserving the parent's null fallbacks for an absent draft, active provider, or selection.
- `apps/web/src/components/ChatView.tsx` — Render the parent's pending HandoffRow with pendingHandoff endpoints and providerStatuses inside the chat-content-lane before the existing thread status line.
- `apps/web/src/components/ChatView.tsx` — Preserve the parent's footer state transitions: show only the status line when no handoff is pending, and suppress the entire footer for paint-only timelines.

## Parent changes intentionally omitted

- `apps/web/src/components/onboarding/WelcomeWizard.tsx` — the parent nightly's changes to this fork-deleted file. Reason: resurrecting it would undo a deletion T3 Pretty made deliberately on main
- `apps/server/src/persistence/reconcileV2PreviewMigration.test.ts` — The parent preview-seeded success-test setup and hard-coded migration expectations at parent IDs 53–62.. Reason: Those expectations conflict with Pretty's shipped migration numbering and deliberate rejection of preview IDs 53 and 54. The fork-ledger upgrade path remains authoritative, while the new ThreadFailureLookupIndex expectation is retained using its manifest-assigned ID.
- `.github/workflows/cursor-hygiene-webhook.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
