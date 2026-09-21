# T3 Pretty upstream integration report

- Parent nightly: `v0.0.43-nightly.20260921.2044`
- Previously integrated parent nightly: `v0.0.43-nightly.20260920.2031`
- Conflict resolver: replayed `automation/sync-resolution-cache` @ `cdfda962ff` for text conflicts from Buildkite #2619 (diff3 key match). No model request in this reconstruction.

## Typecheck

Re-ran the four landing gates on this repair tree after Buildkite #2622 failed the comments gate. `tsc` printed Effect suggestions only; every command exited 0.

- [x] `vp run --filter @t3tools/web typecheck` — exit 0
- [x] `vp run --filter @t3tools/contracts --filter @t3tools/client-runtime typecheck` — exit 0
- [x] `vp run --filter @t3tools/desktop typecheck` — exit 0
- [x] `vp run --filter t3code-relay typecheck` — exit 0

## Post-merge repairs

- `web-typecheck` — Restored `const composerControlsCompact = !composerControlsInStrip && isComposerFooterCompact` in `apps/web/src/components/chat/ChatComposer.tsx`. The cached composer resolution kept Pretty's compact-touch menu branch and the parent's `iconOnlyBlockCount` overflow layout, but dropped the boolean that selects between them (`composerControls` is the control JSX, not that flag).
- `web-typecheck` — Imported `useLayoutEffect` in `apps/web/src/components/chat/ComposerBannerStack.tsx`. The banner file auto-merged (no text conflict): Pretty kept its a11y stack import line, while the parent overflow `NoticeDescription` landed without the hook.

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/Sidebar.tsx` — T3 Pretty's compact, redesigned sidebar-row layout remains authoritative; the removed legacy second title/branch metadata section is not restored, avoiding duplicated content and a visual/sidebar regression.
- `apps/web/src/components/chat/ChatComposer.tsx` — Preserved the dedicated `composerControlsCompact` presentation, including its touch-friendly all-in-one compact controls menu.
- `apps/web/src/components/chat/ChatComposer.tsx` — Preserved T3 Pretty's composer Create PR and review-and-merge/babysit controls, state, visibility rules, and callbacks in both the dedicated compact menu and the responsive overflow menu.
- `apps/web/src/components/chat/ChatComposer.tsx` — Preserved interaction-mode, runtime-mode, and provider-traits controls alongside the fork-specific pull-request controls.
- `apps/web/src/components/chat/ChatComposer.tsx` — Preserved T3 Pretty's local speech-recognition dictation dependencies, including dictation toggling and active-state send validation.
- `apps/web/src/components/chat/ChatComposer.tsx` — Preserved the fork's expanded/collapsed composer cursor handling through expandComposerForEditorChange.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Regression coverage that expanded banners remain in layout flow, retain their stacking order, and become visible through hover/focus without absolute positioning.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Accessible collapsed-stack entry controls, including singular and plural notice labels.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Pretty-specific collapsed-cap theming based on the hidden banner variant and the attached-outline design token.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Single-banner Pretty drawer presentation, warning variant metadata, attached surface styling, compact typography, and safeguards against transform animation overhead.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Per-item surface and action layout customization hooks.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Accessible shared-banner handling for disabled compaction actions and labeled dismissal.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Preserved T3 Pretty's three-column pull-request row layout, which keeps row metadata from overlapping the diff stat in narrow lists.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Preserved T3 Pretty's narrow-list layout fix by explicitly clipping the metadata line, preventing metadata from overlapping the diff stat.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Preserved lifecycle, draft, mergeability, and base-branch conflict information through the shared PullRequestRowGlyph while retaining title-line alignment.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Preserved existing stack navigation, checks popover behavior, matched-description indication, provider metadata, and row selection behavior around the refactor.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — The pull-request number remains in the title-line number slot with T3 Pretty's right-click host-link context menu, avoiding both loss and duplication of that behavior.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — The author label remains visually available at narrow widths by retaining the fork's absence of a responsive sr-only label override, while preserving its maximum-width constraint.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — The surrounding T3 Pretty metadata container and overflow handling used to prevent metadata from overlapping the diff stat remain intact.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — T3 Pretty's PullRequestGlyph import, which protects the fork's restricted-icon replacement and pull-request visual presentation.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — T3 Pretty's openPullRequestLinkOnHost integration for pull-request host-link/context-menu behavior.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — T3 Pretty's PullRequestPanelViewSnapshot and PullRequestSummarySection types used by its pull-request panel navigation and view-state restoration behavior.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — Preserved T3 Pretty’s visible border treatment for pull-request label chips via `border border-border/70`.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — Preserved the `max-w-48` label width constraint used by the existing T3 Pretty layout.
- `apps/web/src/components/pullRequest/pullRequestChecks.test.tsx` — Tests ensuring pull-request check list keys remain stable when host check rows are reordered or their statuses change.
- `apps/web/src/components/pullRequest/pullRequestChecks.test.tsx` — Test ensuring repeated host check runs receive unique React keys.
- `apps/web/src/hooks/useThreadActions.ts` — Preserved T3 Pretty's removal of the `clearDraftThread` store subscription; the adjacent project-scoped draft cleanup selector remains authoritative.
- `apps/web/src/hooks/useThreadActions.ts` — Settlement continues to use the writable thread reference so lifecycle writes are retargeted away from disconnected same-machine twins.
- `apps/web/src/hooks/useThreadActions.ts` — Settlement retains T3 Pretty's optimistic sidebar departure animation and clears the departure marker for both returned failures and thrown mutation errors.
- `apps/web/src/hooks/useThreadActions.ts` — Successful settlement continues to mirror lifecycle writes when retargeted and records the thread's visited wake timestamp.
- `apps/web/src/hooks/useThreadActions.ts` — Unsettling preserves the fork's closed-PR/inactivity auto-settlement suppression semantics for user-pinned active threads.
- `apps/web/src/hooks/useThreadActions.ts` — Pinning continues to mutate the writable target, retain order-key behavior, and mirror successful writes to a retargeted thread.
- `apps/web/src/hooks/useThreadActions.ts` — Lifecycle writes for unpin, settle, snooze, unsnooze, and pinned-thread reorder are directed through readWritableThreadRef so disconnected same-machine twins are not selected as write targets.
- `apps/web/src/hooks/useThreadActions.ts` — Successful lifecycle mutations continue to mirror to a retargeted twin through mirrorLifecycleWriteIfRetargeted.
- `apps/web/src/hooks/useThreadActions.ts` — Settle and snooze retain T3 Pretty's optimistic sidebar departure animation and clear the departure marker for returned failures and thrown mutations.
- `apps/web/src/hooks/useThreadActions.ts` — Settlement capability checks, visited-state updates, pin ordering, and undo restoration use the writable environment without weakening version-skew safeguards.
- `apps/web/src/hooks/useThreadActions.ts` — Snooze and unsnooze writes are redirected through the writable thread reference, avoiding writes to a disconnected same-machine twin.
- `apps/web/src/hooks/useThreadActions.ts` — Successful snooze and unsnooze lifecycle writes are mirrored when retargeting requires it.
- `apps/web/src/hooks/useThreadActions.ts` — Snoozing retains T3 Pretty's optimistic departure marker so thread rows animate out, with the marker cleared on returned failures and thrown mutation errors.
- `apps/web/src/hooks/useThreadActions.ts` — Snooze capability checks and unsupported errors use the actual writable environment and thread.
- `apps/web/src/hooks/useThreadActions.ts` — The fork's client-side canSnooze invariant validation remains intact.
- `apps/web/src/hooks/useThreadActions.ts` — Undo still uses T3 Pretty's unsnoozeThread implementation, which resolves the writable thread target, rejects unsupported environments, invalidates stale snooze undo state, and mirrors lifecycle writes when a thread was retargeted.
- `apps/web/src/hooks/useThreadActions.ts` — The surrounding T3 Pretty snooze behavior remains intact, including client-side snooze invariant checks, optimistic departure animation state, thrown-mutation cleanup, failure cleanup, retargeted lifecycle mirroring, and batch callers' ability to suppress individual undo toasts.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/chat/ChatComposer.tsx` — Integrated the parent's `iconOnlyBlockCount` responsive stage, including `data-composer-block-icon-only` and label/compact-icon visibility styling.
- `apps/web/src/components/chat/ChatComposer.tsx` — Integrated the parent's unified resting-block wrappers with hidden/inert accessibility behavior.
- `apps/web/src/components/chat/ChatComposer.tsx` — Integrated the parent's generalized overflow control container and strip-aware `xs`/`sm` menu sizing for non-compact layouts.
- `apps/web/src/components/chat/ChatComposer.tsx` — Added resetComposerTrigger and setComposerTrigger to the imperative-handle dependency list so parent trigger-state callbacks are refreshed correctly.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Added the parent test proving that the notice-details control appears only when description content overflows.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Integrated ResizeObserver and MutationObserver coverage for width changes and nested-content overflow changes.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Integrated checks that removing the details icon can resolve overflow and that absolutely positioned content still triggers details.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Added the parent's react-test-renderer harness, UI primitive mocks, global stubs, unmount cleanup, and global restoration required by the new behavioral test.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Integrated the parent's PULL_REQUEST_ROW_CLASS shared-style refactor.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Integrated PAGE_ROW_CLASS, including the parent's page-row spacing and intrinsic block-size behavior.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Retained the parent's cursor, transition, focus-outline, and focus-ring styling composition.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Integrated the shared PullRequestRowGlyph and PullRequestRowLines row architecture.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Integrated the visible pull-request number and its host-link context menu.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Integrated the upstream separation of checks/review signals from stack/diff status content.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Integrated PullRequestReviewDecisionGlyph, including host-reported review-required states in addition to approvals and requested changes.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Integrated the upstream monospaced diff-stat presentation supplied by the shared row layout.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Integrated the new PullRequestRowAuthor component and upstream author-first metadata ordering.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Completed the refactored PullRequestRowLines prop structure instead of retaining the obsolete PullRequestMetaLine/manual grid closure.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Passed updatedAt through PullRequestRowLines so the refactored component owns updated-time rendering.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Integrated upstream minimum-width and truncation safeguards for the author and environment metadata.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — Accepted the parent cleanup that removes the pullRequestLabelColor dependency from PullRequestSummaryTab.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — Adopted the parent’s `PullRequestLabelChip` abstraction instead of retaining duplicated inline label-chip markup.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — Retained the parent’s explicit default chip sizing and component-based label rendering.
- `apps/web/src/components/pullRequest/pullRequestChecks.test.tsx` — Expanded documentation explaining that PullRequestRow slots are passed through props and that flatten() traverses element-valued and array-valued props.
- `apps/web/src/hooks/useThreadActions.ts` — Added the parent `timestampFormat` client-setting selector for the upstream timestamp-format behavior used by thread actions.
- `apps/web/src/hooks/useThreadActions.ts` — Unsettling now invalidates any pending settlement undo entry before issuing the mutation.
- `apps/web/src/hooks/useThreadActions.ts` — Pinning now invalidates any pending pin undo entry before issuing the mutation.
- `apps/web/src/hooks/useThreadActions.ts` — Unpin now creates an undo claim, preserves the previous pin order, and offers a failure-aware undo toast.
- `apps/web/src/hooks/useThreadActions.ts` — Settling now invalidates superseded pin and snooze undo claims and offers an undo operation that restores unsettled state, pin state/order, and prior snooze state.
- `apps/web/src/hooks/useThreadActions.ts` — Batch settle calls can suppress per-thread undo toasts with the undoToast option.
- `apps/web/src/hooks/useThreadActions.ts` — Pinned-thread reordering invalidates obsolete pin undo state.
- `apps/web/src/hooks/useThreadActions.ts` — Snooze accepts the parent's optional undoToast setting so batch callers can suppress per-thread undo toasts.
- `apps/web/src/hooks/useThreadActions.ts` — The parent's ThreadUndo snooze action is started and remains active for the normal successful undo-toast path.
- `apps/web/src/hooks/useThreadActions.ts` — Undo actions are finished for failed, thrown, or explicitly toast-suppressed operations.
- `apps/web/src/hooks/useThreadActions.ts` — The parent's placement of unsnooze before snooze is retained and adapted to the fork's retargeting architecture, avoiding a duplicate callback.
- `apps/web/src/hooks/useThreadActions.ts` — Show an undo toast as confirmation after snoozing hides a thread row.
- `apps/web/src/hooks/useThreadActions.ts` — Include the formatted snooze wake time and thread title in the toast.
- `apps/web/src/hooks/useThreadActions.ts` — Associate the toast with the existing undo claim, invoke unsnoozeThread for undo, and report the parent-provided wake failure title.
- `apps/web/src/hooks/useThreadActions.ts` — Return the successful snooze mutation result after displaying the toast.

## Parent changes intentionally omitted

- `apps/web/src/components/Sidebar.tsx` — Use MiddleTruncate for branch names in the parent's legacy sidebar metadata row.. Reason: T3 Pretty intentionally removed that entire legacy title/branch metadata section as part of its custom sidebar redesign. Restoring the section solely to apply MiddleTruncate would duplicate row content and regress the fork's visual design; the supplied conflict boundary contains no surviving equivalent element to which this change can be safely adapted.
- `apps/web/src/components/chat/ChatComposer.tsx` — The parent makes the new adaptive resting-block/overflow layout unconditional and removes the `composerControlsCompact` branch.. Reason: Applying that portion while Pretty's compact mode is active would remove the fork's authoritative touch-friendly compact composer behavior. The parent adaptive implementation is used intact whenever compact mode is not active.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — The two-column grid layout inherited from the parent's shared row styling at this call site.. Reason: It is overridden with T3 Pretty's three-column layout because the dedicated trailing column prevents metadata from overlapping the diff stat in narrow rows.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — The upstream labelClassName that makes the author text screen-reader-only below the @xs/pr-row-meta breakpoint.. Reason: T3 Pretty's current row presentation intentionally renders PullRequestActorLabel without that responsive hiding behavior. Applying it would regress the fork's visible author-label presentation; the upstream PullRequestRowAuthor abstraction and sizing improvements are otherwise retained.
- `apps/web/src/hooks/useThreadActions.ts` — The parent side retained the pre-existing `clearComposerDraftForThread` selector.. Reason: T3 Pretty intentionally removed this selector and its corresponding per-thread cleanup path. Restoring the declaration would regress that fork change and leave an obsolete or unused store subscription.
- `apps/web/src/hooks/useThreadActions.ts` — Remove the local settleThread callback entirely.. Reason: That deletion would regress T3 Pretty's authoritative settlement lifecycle behavior: writable-target retargeting, sidebar departure animation, thrown-error cleanup, mirrored writes, and visited-state tracking. No parent first-party replacement is present in the supplied conflict boundary.
