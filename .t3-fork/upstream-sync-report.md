# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261011.2967`
- Previously integrated parent nightly: `v0.0.46-nightly.20261011.2955`
- Conflict resolver: hand-merge from Origin `main` (`8294392e4`) using `automation/sync-resolution-cache` for 21 of 24 text conflicts
- 0 file(s) remain on an unresolved fork-side fallback

## T3 Pretty changes preserved at conflict boundaries

- `apps/desktop/src/preview/AnnotationStyles.generated.ts` — Kept Pretty's generated preview CSS (truncate, outline-offset). The parent only regenerated the same file from its CSS sources; the AI timed out on the generated blob.
- `apps/mobile/src/features/threads/thread-settings-sheet-state.ts` — Kept Pretty `visibleSheetOptionDescriptors` / `toggleModelFavorite` / instant-apply helpers. Did not restore the parent's staged `pendingModelAfterPress` / `canCommitPendingModel`.
- `apps/mobile/src/features/threads/thread-settings-sheet-state.test.ts` — Kept Pretty helper coverage, including `effectiveProviderFilter` and `visibleSheetOptionDescriptors`.
- `apps/mobile/src/features/threads/ThreadSettingsRows.shared.tsx` — Kept Pretty glass rows and took the parent's hidden-model disable + hide/show control (this is where the parent's `!isHidden` commit guard lands on instant-apply).
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Kept Pretty glass / scenery / instant-apply picker and existing-thread transfer. Took parent hidden-model management on Android and both iOS filter menus. The fallback iOS toolbar is still gated by `hasLegacyModels`.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Kept Pretty scratch entry, glass presentation, and recycled project-list architecture; adapted the parent's Android subtitle fix to the live `renderItem` path.
- `apps/mobile/src/features/threads/ThreadAgentsSheet.tsx` / `ThreadQueueControl.tsx` — Kept Pretty glass chrome and took parent Material / adaptive-layout imports.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — Kept Pretty assistant-delta flush, `subagent_type` role, task-usage, and `lastTool` forwarding; took parent workflow-frame progress and best-effort native task stops.
- `apps/web/src/components/Sidebar.tsx` / `Sidebar.logic.ts` — Kept Pretty search-row subagent indicator, peek pane, and action-sweep shielding; took parent settled-title typography and PR-number search.
- `apps/web/src/components/chat/composerPromptHistory.ts` — Kept Pretty `stripHiddenInstructionSuffixes` / auto-PR suffix stripping; took `ATTACHMENT_ONLY_BOOTSTRAP_PROMPT`.
- `apps/web/src/components/pullRequest/PullRequest{Code,Summary,Timeline}Tab.tsx` — Kept Pretty `data-pull-request-tab-scroll` restoration hooks; took parent `scrollerRef` wiring.
- `apps/web/src/components/ui/switch.tsx` — Kept Pretty 150 ms thumb motion, mixed state, and sizes; took parent removal of persistent `will-change-transform`.
- `apps/web/src/threadRoutes.ts` — Kept Pretty 10s missing-thread grace; took `isThreadRouteSnapshotAuthoritative`.
- `docs/user/telemetry.md` — Kept Pretty agent-monitoring / Sentry docs; took parent OTLP export docs.
- `packages/client-runtime/src/state/subagentRuntime.ts` — Kept Pretty explicit projected kind/usage/activity; took parent `childThreadId` and workflow coordinator inference.
- `packages/contracts/src/settings.ts` — Kept Pretty agent-monitoring, automations, apps, and favorite-skill contracts; took parent model favorites / hidden-models / order patches.
- `packages/shared/src/serverSettings.ts` — Kept Pretty monitoring-consent versioning; took parent favorite / hidden-model merge writes.

## Parent changes integrated at conflict boundaries

- Hidden-model catalog management on mobile (disable selection, hide/show control, Android catalog group, iOS filter menus).
- Workflow-frame task progress and best-effort Claude native task stops.
- Settled-thread title treatment and PR-number search in the sidebar.
- Attachment-only composer prompt-history coverage.
- Pull-request tab scroll refs.
- Reduced-motion-aware switch `will-change` cleanup.
- Authoritative shell snapshot helper for thread routes.
- OpenTelemetry export user docs.
- Runtime `childThreadId` and workflow coordinator inference.
- Model favorites, hidden models, and per-provider order in settings contracts.

## Parent changes intentionally omitted

- Regenerating `AnnotationStyles.generated.ts` from the parent's CSS sources. Pretty's generated blob stays until Pretty's preview CSS is rebuilt.
- Restoring staged model-commit helpers (`pendingModelAfterPress` / `canCommitPendingModel`). Pretty applies the model immediately; hidden-model rejection is on the row (`isHidden` disables selection).
- Parent tests that only cover those staged helpers. Hidden-model coverage lives on the instant-apply row.
- Ungating the fallback iOS thread-settings toolbar so hidden-model management appears without legacy models. The cached resolution left that toolbar on `session.hasLegacyModels`.

## Post-merge repairs

- Pass `environmentId` into Pretty-only `ProviderModelPicker` call sites. Upstream made the prop required so favorites can bind to an environment (`useEnvironmentModelPreferences` / `useToggleEnvironmentModelFavorite`). Null is valid and used by upstream tests — it no-ops favorite writes — but the real environment id is used where one exists:
  - `AutomationEditorDialog`: the dialog's `environmentId` prop (already scoped to the automation's environment).
  - `HomeSuggestionsSettings`: the settings-scope `environmentId`.
  - `AgentsSettings` and `FixAllFindingsDialog`: `primaryEnvironmentIdAtom`, the same id that backs `primaryServerProvidersAtom`.
- Deduplicate auto-merged `"/settings/diagnostics"` keys in `SETTINGS_SECTION_LABELS` and `SETTINGS_CATEGORY_SCOPES`. Pretty already owned the diagnostics page; the parent added the same key in a second position.
- Add required `childThreadId: null` to the `RuntimeSubagent` test fixture in `packages/client-runtime/src/state/subagentActivityLog.test.ts`.
- Drop the duplicate `workflowName` field on `updateClaudeSubagentNode` in `ClaudeAdapterV2.ts`. The cached AI resolution listed it twice and failed server typecheck.
