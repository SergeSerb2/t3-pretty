# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261015.3158`
- Previously integrated parent nightly: `v0.0.46-nightly.20261015.3145`
- Conflict resolver: reused the failed Buildkite #3578 checkpoint cache (`gpt-6.1-sol` / `xhigh`) for five files; `SidebarUpdatePill.tsx` was resolved by hand after that cache key missed

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/ChatView.tsx` — Keep Pretty preview-session sync, Tesla touch composer/focus behavior, terminal and project-script handling, secret-request RPC, implementation-thread PR babysitting, ChatHeader panel-ownership distinction, timeline error containment, live headlines, worktree exit animation, and the Agents entry point.
- `apps/web/src/components/Sidebar.tsx` — Keep the persisted project/folder/all-project rail, hydration-aware folder scope, scratch-machine labels, Pretty store/unstore sweep behavior, and the existing `openProjectSettings` stable path. Do not restore the removed project-settings handler or its refs.
- `apps/web/src/components/chat/ChatComposer.tsx` — Keep Tesla touch UI, browser dictation, and Pretty's running-thread steering with opt-in `legacyQueueEnabled` queueing.
- `apps/web/src/components/settings/IntegrationsSettings.tsx` — Keep Agent Computer Control and apply T3 Pretty branding to the new pull-request-links setting.
- `apps/web/src/components/sidebar/SidebarUpdatePill.tsx` — Keep Pretty's check-icon spin/settle motion, `--refresh-cw-from` styling, and inlined nightly release-notes popover.
- `docs/user/updating.md` — Keep the T3 Pretty R2 feed as the update channel and the deliberate omission of npm-publication prerequisites.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/ChatView.tsx` — Adopt the parent's module-level callback factories and `useStableCallback` wiring so old ChatView closures no longer stay alive.
- `apps/web/src/components/Sidebar.tsx` — Convert `scratchMachineLabelFor` to a component-local function and drop obsolete dependency arrays on the multi-select and thread context-menu stable callbacks.
- `apps/web/src/components/chat/ChatComposer.tsx` — Adopt the parent's plain-handler plus `useStableCallback` architecture for submit, citation, implement-plan, compact-context, and model-picker paths, while keeping Pretty's steering/queue policy.
- `apps/web/src/components/settings/IntegrationsSettings.tsx` — Add `PullRequestLinksOpenInAppSetting` with both toggle directions and reset-to-true.
- `apps/web/src/components/sidebar/SidebarUpdatePill.tsx` — Wire the pill to the parent capsule progress API (`describeUpdateCapsule`, `SidebarUpdateCapsule`, handed-off server follow-up, Later/Retry/Dismiss). Per-machine status stays in the capsule popover via `resolveUpdateRunMachineStatus` and `RUN_STATUS_LABELS`.
- `docs/user/updating.md` — Document the widening progress button, slow-machine callout, Retry, countdown/Later, and servers that keep restarting after the desktop app relaunches.

## Parent changes intentionally omitted

- `apps/web/src/components/Sidebar.tsx` — Convert `handleProjectSettings` from `useCallback` to `useStableCallback`. Reason: Pretty deleted that handler and its supporting refs; the surviving `openProjectSettings` path already uses `useStableCallback`.
- `apps/web/src/components/chat/ChatComposer.tsx` — Restore `settings.followUpBehavior` on the refactored parent handlers. Reason: Pretty steers running-thread messages by default and queues only when `legacyQueueEnabled` is on.
- `apps/web/src/components/settings/IntegrationsSettings.tsx` — The new setting's T3 Code product-name copy. Reason: replaced with T3 Pretty; behavior is unchanged.
- `docs/user/updating.md` — npm-publication prerequisites and the remote-desktop npm exemption. Reason: Pretty documents the R2 feed instead.
- `apps/web/src/components/sidebar/SidebarUpdatePill.tsx` — Reintroduce `describeUpdateRun` or drop the per-machine progress UI. Reason: nightly 3158 replaced that helper with `describeUpdateCapsule` and the capsule popover; Pretty's old tooltip import is the typecheck that blocked Buildkite #3578.

## Post-merge repairs

- `web-typecheck` failed on the automated #3578 tree because `SidebarUpdatePill.tsx` still imported `describeUpdateRun` after `updateEverything.logic.ts` auto-merged to the capsule API. This hand-merge wires the pill to that replacement API, keeps Pretty motion and release notes, and adds a cheap export regression so the old name cannot come back.
