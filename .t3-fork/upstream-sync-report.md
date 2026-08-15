# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260815.1101`
- Previously integrated parent nightly: `v0.0.34-nightly.20260815.1098`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/desktop/src/preview/Manager.ts` — Preserved T3 Pretty canvas workspace behavior by reactivating an existing frame-capture session when a preview tab registers a replacement webview.
- `apps/marketing/src/pages/index.astro` — Preserved the fork-specific Kimi provider mark in the documented six-mark mobile hero arrangement.
- `apps/marketing/src/pages/index.astro` — Preserved T3 Pretty's intent to keep central hero content clear around the floating provider marks.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Markdown links continue to expose the T3 Pretty long-press action sheet, including copy and open actions.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Markdown link presses remain delegated through the shared handler, preserving workspace-file navigation and link-type-aware routing.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Pull-request links continue to open in T3 Pretty's native pull-request view with selection haptics instead of being sent directly to an external browser.
- `apps/server/src/orchestration/ActivityPayloadProjection.test.ts` — Retained the T3 Pretty regression test ensuring non-MCP dynamic tool calls preserve toolName and toolCallId for the subagent activity feed.
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` — Preserved T3 Pretty's activity compaction in both thread-detail queries: older context-window updates are discarded per turn, and tool updates superseded by a later completion in the same projection group are omitted.
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` — Preserved the fork's sequence-aware deterministic sort key, including its handling of activities without a sequence.
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` — Preserved windowed thread filtering for turn-key boundaries and turnless activities, followed by stable ascending activity output.
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` — Preserved the retained-ID join back to projection_thread_activities, including the valid `activity` alias used by the shared final ordering.
- `apps/web/src/AppRoot.tsx` — Preserved the `isElectron` import and Electron-only guard for T3 Pretty's `SurgeConnectMeshSync`, maintaining desktop relay mesh synchronization behavior.
- `apps/web/src/components/ChatView.tsx` — Review comments remain appended to the outgoing prompt before file attachment metadata.
- `apps/web/src/components/ChatView.tsx` — Attached non-image file paths remain encoded in the invisible agent-facing suffix while staying out of the visible timeline bubble.
- `apps/web/src/components/ChatView.tsx` — Attachment-only and image-only sends retain the bootstrap prompt fallback.
- `apps/web/src/components/ChatView.tsx` — The T3 Pretty auto-create-PR instruction remains applied with the selected model attribution and correct first-message/thread-start behavior.
- `apps/web/src/components/ThreadStatusIndicators.test.ts` — Preserved coverage for T3 Pretty's Codex automated-review status surfaced through the git PR menu by retaining the automatedReviewIndicator import.
- `apps/web/src/components/ThreadStatusIndicators.tsx` — Preserved the full T3 Pretty icon set used to display Codex automated-review states, including reviewing, passed, feedback, history, and warning presentations.
- `apps/web/src/components/ThreadStatusIndicators.tsx` — Preserved resolveAutomatedReviewPresentation and the existing T3 Pretty automated-review status behavior surfaced through the pull-request menu.
- `apps/web/src/components/chat/ChatComposer.tsx` — Preserved T3 Pretty's `MenuDivider` alias used by the fork's composer menu and skills-picker presentation.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — T3 Pretty's AnimatedHeight-based expand/collapse motion for tool-call details remains intact, including keeping the animated container mounted whenever expandable content exists.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Existing interaction isolation for selectable expanded content is retained through stopRowToggle on click and pointer-down.
- `apps/web/src/components/cloud/ConnectCliAuthSurface.tsx` — Preserved the shared Surge Connect and Surge Code account branding constants required by the authorization and callback UI.
- `apps/web/src/components/cloud/ConnectCliAuthSurface.tsx` — Preserved the T3 Pretty sign-in label, "Sign in to {SURGE_CODE_ACCOUNT_NAME}", rather than reverting to the parent's generic wording.
- `apps/web/src/components/cloud/ConnectCliAuthSurface.tsx` — Kept the existing SURGE_CONNECT_NAME-based authorization descriptions and security warning intact.
- `apps/web/src/components/preview/PreviewPanelShell.tsx` — T3 Pretty's explicit open and maximized state handling for animated right-panel entry and exit remains authoritative.
- `apps/web/src/components/preview/PreviewPanelShell.tsx` — The maximized-panel exit lifecycle, including delayed onExitComplete handling and the elevated exit frame, remains intact.
- `apps/web/src/components/preview/PreviewPanelShell.tsx` — Inline resize state remains exposed through isResizing so Pretty's resizing data attribute and transition behavior continue to work.
- `apps/web/src/components/preview/PreviewPanelShell.tsx` — The fork's CSS-variable-based inline panel width and typed CSSProperties usage are retained, as are its keyed Fragment panel contents.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Preserved the fork-owned Surge Connect identity by using SURGE_CONNECT_NAME for the managed-tunnel title and both state-dependent descriptions.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Preserved T3 Pretty's existing managed-tunnel state, error display, permission/sign-in/pending guards, disabled-reason tooltip, and update handler.
- `packages/contracts/src/orchestration.test.ts` — Preserved the ClientOrchestrationCommand import used by T3 Pretty contract coverage.
- `packages/contracts/src/orchestration.test.ts` — Preserved the Kimi-specific runtime-mode invariant: legacy `yolo` remains `yolo` for Kimi but normalizes to `full-access` for Codex, Claude Agent, and unknown drivers, while existing non-yolo modes remain unchanged.
- `packages/ssh/src/tunnel.test.ts` — Preserved coverage requiring Windows remote launch, pairing, and stop operations to use native cmd.exe and Node lifecycle scripts rather than POSIX sh.
- `packages/ssh/src/tunnel.test.ts` — Preserved validation of Windows managed-server launch metadata and pairing credentials across the complete remote lifecycle.
- `packages/ssh/src/tunnel.ts` — Windows SSH remote launch continues to invoke Node with the remote state key and use the dedicated Windows launch script.
- `packages/ssh/src/tunnel.ts` — POSIX remote launch continues to use the existing shell command and T3 Pretty remote launch script.

## Parent changes integrated at conflict boundaries

- `apps/desktop/src/preview/Manager.ts` — Integrated the parent race fix that reasserts the committed tab zoom after registration, covering zoom actions that targeted the replaced guest while attachment was in flight.
- `apps/marketing/src/pages/index.astro` — Integrated the parent's more accurate description of three marks above the headline and two marks beside the CTA.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — External markdown links that are not handled as native pull requests now use tryOpenExternalUrl with the markdown-link source instead of calling Linking.openURL directly.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — The guarded external URL behavior is centralized in onMarkdownLinkPress and therefore applies to both favicon-style external links and ordinary markdown links.
- `apps/server/src/orchestration/ActivityPayloadProjection.test.ts` — Added coverage that Codex command execution payloads retain only a bounded first-line aggregated output summary while preserving the command.
- `apps/server/src/orchestration/ActivityPayloadProjection.test.ts` — Added coverage that Claude and ACP command execution payloads normalize their output into bounded rawOutput summaries and remain under the payload-size limit.
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` — Integrated `THREAD_DETAIL_ACTIVITY_LIMIT` into both the regular and windowed thread-detail activity queries.
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` — Integrated the parent's newest-first candidate selection using sequence, creation time, and activity ID before returning results in ascending order.
- `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` — Applied the parent limit before T3 Pretty's compaction CTEs, retaining the parent's bounded raw scan behavior while composing it with fork-specific filtering.
- `apps/web/src/AppRoot.tsx` — Integrated the parent `QuitHoldOverlay` import so the upstream overlay already rendered by `AppRoot` is available.
- `apps/web/src/components/ChatView.tsx` — Message IDs and creation timestamps are no longer generated at the old pre-validation location; the upstream definitions after the mobile composer transition and beginLocalDispatch call are used instead, avoiding duplicate declarations and preserving the new dispatch ordering.
- `apps/web/src/components/ThreadStatusIndicators.test.ts` — Integrated the parent nextThreadChangeRequestSnapshot helper import used by the upstream thread change-request snapshot tests.
- `apps/web/src/components/ThreadStatusIndicators.tsx` — Integrated the parent Effect Atom reactivity import needed by the newest atom-backed status implementation.
- `apps/web/src/components/ThreadStatusIndicators.tsx` — Integrated the parent appAtomRegistry dependency used to bind reactive status state to the application registry.
- `apps/web/src/components/chat/ChatComposer.tsx` — Integrated the parent composer submission helpers for prompt-length validation, submission validation, and draft submission.
- `apps/web/src/components/chat/ChatComposer.tsx` — Integrated the parent `ComposerPromptLengthValidation` component import.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Adopted the parent refactor to style expanded tool-call content through toolCallExpandedBodyClassName instead of duplicating the literal class list.
- `apps/web/src/components/cloud/ConnectCliAuthSurface.tsx` — Integrated the parent's useCallback React import required by the new openSignIn callback.
- `apps/web/src/components/cloud/ConnectCliAuthSurface.tsx` — Integrated the parent's openSignIn button handler, which records the CLI authorization state and uses the request-aware Clerk redirect URL before opening sign-in.
- `apps/web/src/components/preview/PreviewPanelShell.tsx` — Adopted the parent's host-ref-based useClampedMaxWidth implementation so inline panel width is constrained by both viewport and containing flex-row space.
- `apps/web/src/components/preview/PreviewPanelShell.tsx` — Integrated the parent's optimization that disables container measurement outside inline, non-maximized mode.
- `apps/web/src/components/preview/PreviewPanelShell.tsx` — Integrated the RefObject, useLayoutEffect, and useRef dependencies required by the parent's resize-observer implementation.
- `apps/web/src/components/preview/PreviewPanelShell.tsx` — Adapted the parent measurement ref to T3 Pretty's split inline/non-inline render architecture by attaching it to the inline frame that competes with the sibling column.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Integrated the parent change that renders the managed T3/Surge Connect tunnel setting only when window.desktopBridge is available, while leaving the separate agent-activity publishing setting available outside that condition.
- `packages/contracts/src/orchestration.test.ts` — Integrated the parent `isProviderSendTurnSupportedImageMimeType` import.
- `packages/contracts/src/orchestration.test.ts` — Integrated upstream test coverage confirming PNG and case-insensitive JPEG MIME types are accepted while SVG is rejected.
- `packages/ssh/src/tunnel.test.ts` — Integrated the parent regression test proving a cold remote launch may run for 75 seconds without being terminated by the default SSH command timeout, using TestClock and fiber completion.
- `packages/ssh/src/tunnel.ts` — Added REMOTE_LAUNCH_TIMEOUT_MS to the remote server launch SSH command, preventing launch operations from running without the parent-defined timeout.

## Parent changes intentionally omitted

- `apps/web/src/components/cloud/ConnectCliAuthSurface.tsx` — The parent's generic "Sign in" button label.. Reason: T3 Pretty's Surge Code account branding is authoritative presentation and can coexist with the parent's improved sign-in behavior.
