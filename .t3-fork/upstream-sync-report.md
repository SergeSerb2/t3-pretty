# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260817.1113`
- Previously integrated parent nightly: `v0.0.34-nightly.20260816.1110`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/desktop/src/ipc/methods/preview.ts` — Preserved DesktopPreviewTabImageSchema, which supports T3 Pretty's canvas workspace and desktop tab-image capture behavior.
- `apps/desktop/src/preview/Manager.ts` — Retained the DesktopPreviewTabImage contract import used by T3 Pretty's desktop preview tab-image functionality.
- `apps/server/src/pullRequest/GitHubPullRequestProvider.ts` — GitHub CLI rate-limit errors remain classified as `rate-limited`, preserving T3 Pretty’s API-quota protection behavior.
- `apps/server/src/pullRequest/GitHubPullRequestProvider.ts` — Existing missing-tool, unauthenticated, and generic failure classifications remain unchanged semantically.
- `apps/web/src/components/preview/previewAutomationOpenReadiness.ts` — The T3 Pretty desktop readiness helper continues to catch status-read failures from dormant or missing preview tabs and returns `false`, allowing readiness to be retried instead of failing the automation request.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — T3 Pretty's explicit quota-safe live-refresh interval and minimum interval remain in force, and ordinary polling continues to use the server cache rather than invalidating GitHub data every tick.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Manual host refreshes retain T3 Pretty's in-flight and pending-query guards, cooldown, cache invalidation, full detail/activity reread, and diff warm-up.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — The optional accumulated diff-reset behavior and refresh-token update are preserved, including resetting the diff when the pull request's diff identity changes.
- `apps/web/src/components/settings/SettingsSidebarNav.tsx` — Preserved T3 Pretty’s Settings navigation entries and icons for agent instruction files, global/per-thread subagent policy, and skills.
- `apps/web/src/components/settings/settingsSearch.ts` — The Instructions settings route, section label, and searchable entries for global and project agent instructions remain available.
- `apps/web/src/components/settings/settingsSearch.ts` — The Agents settings route, section label, and searchable subagent controls for enabling subagents and selecting the default child model remain available.
- `apps/web/src/components/settings/settingsSearch.ts` — The Skills settings route, section label, and searchable entries for installed, environment-specific, and marketplace skills remain available.
- `apps/web/src/components/settings/settingsSearch.ts` — The fork's existing settings-section and search-result ordering is retained, with the new upstream section added after the fork-specific sections.
- `apps/web/src/routeTree.gen.ts` — Preserved the T3 Pretty `/settings/instructions` route and all generated route registration and type metadata supporting instruction-file management from Settings.
- `apps/web/src/routeTree.gen.ts` — Kept T3 Pretty's `/settings/instructions` route, including its generated route typing and child registration, preserving the fork's instruction-file management settings.

## Parent changes integrated at conflict boundaries

- `apps/desktop/src/ipc/methods/preview.ts` — Integrated DesktopPreviewCreateTabInputSchema for the parent createTab IPC payload implementation.
- `apps/desktop/src/preview/Manager.ts` — Integrated the parent DesktopPreviewTabDefaults contract import for the newest preview tab-defaults API.
- `apps/server/src/pullRequest/GitHubPullRequestProvider.ts` — Changed `gitHubProviderFailure` to return the structured `PullRequestProviderFailure` object required by the surrounding object-spread construction.
- `apps/server/src/pullRequest/GitHubPullRequestProvider.ts` — Added handling for `SourceControlRateLimitPausedError`, preserving its `retryAt` value in the provider failure.
- `apps/server/src/pullRequest/GitHubPullRequestProvider.ts` — Wrapped all failure reasons in the parent’s updated `{ reason }` representation.
- `apps/web/src/components/preview/previewAutomationOpenReadiness.ts` — Added the parent documentation explaining when a freshly opened automation tab requires the deterministic fallback viewport and why configured defaults do not.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Live watching now refreshes only the inexpensive core pull-request detail query, allowing the existing revision effect to refresh heavier activity data only when the pull request reports a change.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — The parent's cache-busting manual-refresh ordering—invalidating before rereading detail and activity—remains incorporated inside the fork's guarded refresh implementation.
- `apps/web/src/components/settings/SettingsSidebarNav.tsx` — Added the parent’s integrations Settings navigation icon mapping using BlocksIcon.
- `apps/web/src/components/settings/settingsSearch.ts` — Added the parent `/settings/integrations` path and its `Integrations` section label.
- `apps/web/src/components/settings/settingsSearch.ts` — Added searchable browser integration settings for default viewport, default zoom, default appearance, and automatic floating-preview display.
- `apps/web/src/components/settings/settingsSearch.ts` — Preserved the upstream `browser` anchor target for all four browser integration search results.
- `apps/web/src/routeTree.gen.ts` — Integrated the parent `/settings/integrations` route, including its import, settings-child registration, full-path/to/id mappings, and generated route unions.
- `apps/web/src/routeTree.gen.ts` — Added the parent `/settings/integrations` route to generated path typing and registered it as a settings child without displacing the fork's instructions route.

## Parent changes intentionally omitted

- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Use the default, unqualified useLiveRefresh cadence from the parent call.. Reason: T3 Pretty's explicit interval and minimum interval are retained to protect the GitHub API quota.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Run every manual refresh request unconditionally with an unconditional immediate diff-token reset.. Reason: T3 Pretty deliberately coalesces overlapping or pending host requests, applies a cooldown to avoid duplicate API work and stale epochs, and supports callers that do not require a diff reset.
