# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261010.2935`
- Previously integrated parent nightly: `v0.0.46-nightly.20261010.2922`
- Conflict resolver: hand-merge from Origin `main` (`6cb8c1ed7`)
- 0 file(s) remain on an unresolved fork-side fallback

## T3 Pretty changes preserved at conflict boundaries

- `apps/desktop/src/ipc/methods/window.ts` — Kept `resolveEditorExecutable` while adopting `.icns` project-icon picker extensions.
- `apps/server/src/assets/AssetAccess.ts` — Kept managed computer-picked icons and Grok session images; serve `.icns` as embedded PNG.
- `apps/server/src/assets/AssetAccess.test.ts` — Kept managed-icon coverage and added the parent macOS `.icns` PNG test.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — Kept Claude subagent `role` while adopting reported reasoning `effort`.
- `apps/server/src/workspace/WorkspaceSearchIndex.ts` — Kept invalid-path truncation accounting; favicon search now includes `.icns`.
- `apps/web/src/components/chat/ComposerPendingUserInputPanel.tsx` — Kept the stale-timer comment and adopted the parent cancel-on-navigation/disabled cleanup.
- `apps/web/src/components/chat/providerIconUtils.test.ts` — Kept Grok package-icon mapping coverage and added OpenCode Zen/Go label tests.
- `apps/web/src/components/settings/settingsSearch.ts` — Kept Pretty home-suggestions, live-activity, scenery, and agent-monitoring rows; added Version and Update track.
- `apps/web/src/routes/settings.tsx` — Kept Pretty's `settingsEscapeAction` Escape handling; adopted Diagnostics/Providers mount-key so those panels stay mounted across project switches.
- `packages/shared/src/KeyedCoalescingWorker.ts` — Adopted tail-requeue fairness so a busy key cannot starve others; still propagate processor interrupts.
- `packages/shared/src/projectFavicon.ts` — Kept managed `t3-project-icon/` helpers and added `.icns` to project-favicon extensions.

## Parent changes integrated at conflict boundaries

- macOS `.icns` project icons (picker, path classification, PNG extraction, search).
- OpenCode Zen vs Go provider-row labels and display-name qualifier stripping.
- Settings Version / Update track search entries and hosted-channel visibility.
- Diagnostics and Providers stay mounted when only the project scope changes.
- Question auto-advance cancels after navigation or when permission is revoked.
- Keyed coalescing worker yields to other keys between batches of a busy key.
- Claude subagents record the reasoning effort they actually run at.

## Parent changes intentionally omitted

- `apps/web/src/routes/settings.tsx` — Parent `useEscapeToGoBack` on the settings layout. Pretty already handles Escape through `settingsEscapeAction` (ignore / blur / leave). The generic hook would skip that and double-fire with the existing listener.

## Post-merge repairs

- `mergeLearnedRoutes` no longer auto-learns `http:`/`ws:` routes when `allowInsecure` is true. Saved plaintext routes still stay and can still receive Tailscale labels. This is the Buildkite #3355 publication gate.
- Restore `Menu` imports on the draft-hero pull-request picker so web typecheck passes. The Combobox project-picker change had dropped them while the Pretty PR-attachment menu still used those components.
