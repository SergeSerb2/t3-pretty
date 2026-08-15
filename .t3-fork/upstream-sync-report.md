# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260815.1102`
- Previously integrated parent nightly: `v0.0.34-nightly.20260815.1101`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/desktop/resources/icon.icns` — kept the fork-owned binary asset; binary conflicts are never model input
- `apps/desktop/resources/icon.ico` — kept the fork-owned binary asset; binary conflicts are never model input
- `apps/desktop/resources/icon.png` — kept the fork-owned binary asset; binary conflicts are never model input
- `apps/desktop/scripts/electron-launcher.mjs` — T3 Pretty's branded macOS icon remains the source artwork for development launchers.
- `apps/desktop/scripts/electron-launcher.mjs` — T3 Pretty branding is also applied to the newly introduced production PNG icon source.
- `apps/desktop/src/app/DesktopAppIdentity.test.ts` — The desktop identity test fixture continues to expose the branded application name "T3 Pretty" rather than reverting to "T3 Code".
- `apps/desktop/src/app/DesktopEnvironment.ts` — T3 Pretty development builds continue to use the fork-branded `assets/pretty/t3-pretty-1024.png` dock icon rather than the former upstream blueprint icon.
- `apps/desktop/src/app/DesktopLifecycle.test.ts` — The desktop lifecycle test continues to use the T3 Pretty application name rather than reverting branding to T3 Code.
- `apps/desktop/src/backend/DesktopBackendManager.test.ts` — Preserved T3 Pretty's regression test proving that a managed desktop backend which binds after the one-minute bootstrap readiness timeout still transitions to ready and can open the window, while remaining explicitly unready before it binds.
- `apps/desktop/src/backend/DesktopBackendManager.ts` — A backend that binds after the initial readiness timeout is still detected, and `onReady` is invoked so T3 Pretty can open the desktop window instead of remaining stuck during a slow startup.
- `apps/desktop/src/backend/DesktopBackendManager.ts` — Slow WSL and post-update backend launches remain supported beyond the initial readiness budget.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.test.ts` — The desktop telemetry test fixture continues to identify the application as "T3 Pretty" rather than reverting fork branding to "T3 Code".
- `apps/desktop/src/window/DesktopApplicationMenu.test.ts` — The mocked Electron application name remains "T3 Pretty", preserving fork branding and identity in the desktop menu test.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Preserved reuse of pending-task turn identifiers and preallocation of new turn metadata so pull-request preparation and thread creation share the same thread ID.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Preserved native new-task pull-request checkout preparation, including failure/interruption handling and rejection of responses without a worktree path.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Preserved creation of the thread in local mode at the already-prepared PR worktree, preventing creation of a duplicate worktree and disabling start-from-origin for that handoff.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Preserved tracking of a stale pull-request checkout so the existing post-creation warning remains functional.
- `apps/server/src/orchestration/decider.settled.test.ts` — Preserved the test fixture's branch and branchEventId arguments used to protect T3 Pretty PR branch identity and settlement behavior.
- `apps/server/src/orchestration/decider.settled.test.ts` — Preserved existing positional pinnedAt fixture compatibility for T3 Pretty tests.
- `packages/shared/src/git.ts` — Git-documented scp-style remote support with an optional, non-`git`-specific username, including username-less `host:path/to/repo` remotes.
- `packages/shared/src/git.ts` — Compatibility normalization for the legacy `git@host/path/to/repo` form.
- `packages/shared/src/git.ts` — Safeguards that prevent Windows drive paths and Git remote-helper `transport::address` syntax from being misidentified as scp-style remotes.
- `packages/shared/src/git.ts` — Protection against treating ordinary slash-separated values such as `alice@github.com/team/repo` as remote URLs.
- `packages/shared/src/sourceControl.test.ts` — Preserved the T3 Pretty Codex automated-review presentation import and its associated lifecycle and no-signal test coverage.
- `packages/shared/src/sourceControl.ts` — Preserved the T3 Pretty safeguard that rejects Windows drive paths such as `c:/repos` and `c:repos` before they can be misclassified as source-control remotes.

## Parent changes integrated at conflict boundaries

- `apps/desktop/scripts/electron-launcher.mjs` — Updated the launcher cache/version constant from 14 to 15.
- `apps/desktop/scripts/electron-launcher.mjs` — Integrated the parent's separate production macOS PNG icon source required by the updated launcher flow.
- `apps/desktop/scripts/electron-launcher.mjs` — Accepted removal of the obsolete defaultIconPath declaration in favor of the parent's PNG-based icon handling.
- `apps/desktop/src/app/DesktopAppIdentity.test.ts` — Added the ElectronApp systemLocale service member with the upstream test locale "en-US", keeping the mock compatible with the parent API.
- `apps/desktop/src/app/DesktopLifecycle.test.ts` — Added the parent ElectronApp systemLocale mock returning "en-US", keeping the test compatible with the expanded service API.
- `apps/desktop/src/backend/DesktopBackendManager.test.ts` — Integrated the upstream runBackendProcess regression test covering repeated readiness-budget expiration while the child remains alive.
- `apps/desktop/src/backend/DesktopBackendManager.test.ts` — Integrated assertions that each expired budget invokes onReadinessFailure, probing continues into a third round, readiness is eventually reported exactly once, and the backend process exits cleanly.
- `apps/desktop/src/backend/DesktopBackendManager.ts` — Adopted the parent's first-party readiness loop, which gives every attempt a fresh configured timeout and keeps probing until the backend becomes ready or the backend run scope ends.
- `apps/desktop/src/backend/DesktopBackendManager.ts` — Integrated the parent's timeout signaling: each failed attempt invokes `onReadinessFailure`, returns `false`, and triggers another probe; a successful attempt invokes `onReady` and terminates the repeat loop.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.test.ts` — Added the ElectronApp systemLocale mock with an "en-US" value, keeping the test layer compatible with the parent's expanded ElectronApp service API.
- `apps/desktop/src/window/DesktopApplicationMenu.test.ts` — Added the ElectronApp systemLocale mock returning "en-US", keeping the test service compatible with the parent's updated ElectronApp API.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Integrated resolveProjectThreadCreationBranch for the final workspace mode and branch before createProjectThread.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Adapted the resolver's current-checkout input for the fork's prepared PR worktree: after PR preparation, the returned branch is the effective checkout branch rather than the original project's checkout branch.
- `apps/server/src/orchestration/decider.settled.test.ts` — Integrated the parent's lifecycle-object fixture API for pinnedAt, snoozedUntil, and snoozedAt.
- `apps/server/src/orchestration/decider.settled.test.ts` — Integrated automatic legacy snoozedAt fixture initialization to SETTLED_AT when snoozedUntil is present, supporting the parent's settle-and-unsnooze and repair tests.
- `packages/shared/src/git.ts` — Expanded scp-style normalization beyond the former `git@`-only matcher to recognize ordinary non-`git` usernames such as `alice@host:owner/repo`.
- `packages/shared/src/git.ts` — Applied colon-delimited scp parsing to standard remote forms, avoiding the old general acceptance of slash as the host/path separator.
- `packages/shared/src/sourceControl.test.ts` — Integrated the parent isSshRemoteUrl import needed for upstream SSH remote URL behavior and test coverage.
- `packages/shared/src/sourceControl.ts` — Integrated the parent change that extracts SCP-style SSH remote hosts through the shared `SCP_SSH_REMOTE_PATTERN`, keeping host detection consistent with `isSshRemoteUrl`.

## Parent changes intentionally omitted

- `apps/desktop/resources/icon.icns` — the parent nightly's deletion of this binary asset. Reason: binary content cannot be text-merged and the fork's branded assets are authoritative
- `apps/desktop/resources/icon.ico` — the parent nightly's deletion of this binary asset. Reason: binary content cannot be text-merged and the fork's branded assets are authoritative
- `apps/desktop/resources/icon.png` — the parent nightly's deletion of this binary asset. Reason: binary content cannot be text-merged and the fork's branded assets are authoritative
- `apps/desktop/scripts/electron-launcher.mjs` — Use the parent's Blueprint development icon and black production icon artwork.. Reason: Those assets are parent branding and would regress T3 Pretty's authoritative visual identity; the upstream development/production icon mechanism is retained with T3 Pretty artwork substituted.
- `apps/desktop/src/app/DesktopAppIdentity.test.ts` — Use "T3 Code" as the ElectronApp name in this test fixture.. Reason: This would regress the fork's authoritative T3 Pretty desktop branding; the parent line was adapted to the fork identity instead.
- `apps/desktop/src/app/DesktopEnvironment.ts` — Remove the `developmentDockIconPath` assignment from the desktop environment.. Reason: The assignment is required for T3 Pretty's fork-specific branding and development dock icon. Applying the upstream deletion would regress the fork's visual identity.
- `apps/desktop/src/telemetry/DesktopTelemetryPublisher.test.ts` — Change the mocked Electron application name to "T3 Code".. Reason: This would regress authoritative T3 Pretty branding; only the parent branding value is omitted while its systemLocale API addition is integrated.
- `apps/desktop/src/window/DesktopApplicationMenu.test.ts` — Use "T3 Code" as the mocked Electron application name.. Reason: This would regress T3 Pretty's authoritative fork branding; only the parent brand value is replaced, while the accompanying API addition is integrated.
- `packages/shared/src/git.ts` — Upstream's exact restrictive matcher requires an explicit username limited to `[a-zA-Z0-9._-]+`.. Reason: T3 Pretty already supports Git's optional username syntax and valid usernames outside that narrow whitelist; the broader fork matcher includes every remote accepted by upstream.
- `packages/shared/src/git.ts` — Upstream rejects the legacy slash-delimited `git@host/path/to/repo` form.. Reason: T3 Pretty explicitly preserves this narrowly scoped legacy compatibility while continuing to reject other slash-separated values.
