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

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.43-nightly.20260921.2044`
- Previously integrated parent nightly: `v0.0.43-nightly.20260921.2044`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/Sidebar.tsx` — Preserved T3 Pretty's compact, redesigned sidebar-thread row structure, including the existing integrated status and action presentation without appending a duplicate title/branch metadata section.
- `apps/web/src/components/Sidebar.tsx` — Preserved the fork's sidebar visual density and interaction layout around Woke status, snooze, draft discard, and settlement controls.
- `apps/web/src/components/chat/ChatComposer.tsx` — Preserved T3 Pretty's `composerControlsCompact` calculation for compact footer behavior when controls are not rendered in the resting strip.
- `apps/web/src/components/chat/ChatComposer.tsx` — The dedicated composerControlsCompact layout remains a single touch-friendly CompactComposerControlsMenu rather than rendering the full resting-control block set.
- `apps/web/src/components/chat/ChatComposer.tsx` — T3 Pretty's Create PR and review-and-merge/babysit controls remain available in both the dedicated compact menu and the responsive overflow menu, including their toggle callbacks.
- `apps/web/src/components/chat/ChatComposer.tsx` — Existing compact-mode, interaction-mode, runtime-mode, and provider-traits behavior remains intact.
- `apps/web/src/components/chat/ChatComposer.tsx` — Preserved the T3 Pretty local speech-recognition dictation dependencies (`dictation.toggle` and `dictation.active`), including correct memo updates when dictation state changes.
- `apps/web/src/components/chat/ChatComposer.tsx` — Preserved `expandComposerForEditorChange`, which supports the fork's composer expansion behavior.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Tests protecting T3 Pretty's in-flow expanded banner layout, hover/focus visibility, and banner ordering.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Accessibility coverage for the focusable collapsed-stack cap and singular/plural notice labels.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Variant-aware collapsed-cap theming, including Pretty's attached-outline styling for neutral notices.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Single-banner Pretty drawer surface, attached styling, compact typography, variant metadata, and no-transform behavior.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Support for item-specific surface/action classes and the accessible disabled compaction action with dismiss labeling.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Preserved the explicit three-column pull-request row layout so the glyph, metadata/content, and trailing diff stat occupy separate columns and do not overlap in narrow lists.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Preserved `overflow-hidden` on the pull-request metadata container, protecting T3 Pretty's narrow-list fix that prevents metadata from overlapping the diff stat.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Preserved T3 Pretty's current `PullRequestRowLines` layout, metadata ordering, host-link context menu, provider display, environment label, and row-author component.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — Preserved use of T3 Pretty's PullRequestGlyph rather than regressing to restricted Lucide pull-request icons.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — Preserved host-aware pull-request link opening and context-menu behavior through openPullRequestLinkOnHost.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — Preserved pull-request panel view snapshot and summary-section state used for T3 Pretty navigation and scroll restoration behavior.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — T3 Pretty's pull-request label chips retain the `border border-border/70` visual treatment and existing maximum width.
- `apps/web/src/components/pullRequest/pullRequestChecks.test.tsx` — Test coverage ensuring pull-request check keys remain stable when host-reported checks reorder or change status.
- `apps/web/src/components/pullRequest/pullRequestChecks.test.tsx` — Test coverage ensuring repeated host check runs receive unique React list keys.
- `apps/web/src/hooks/useThreadActions.ts` — Preserved the T3 Pretty `timestampFormat` client-setting lookup used by thread actions.
- `apps/web/src/hooks/useThreadActions.ts` — Manual unsettle remains documented consistently with T3 Pretty's lifecycle policy: closed pull requests or inactivity may auto-settle, while merely merging a pull request does not.
- `apps/web/src/hooks/useThreadActions.ts` — Pin writes continue to use the resolved writable environment instead of an obsolete or disconnected same-machine target.
- `apps/web/src/hooks/useThreadActions.ts` — Successful pin writes continue through the existing result-aware path so `mirrorLifecycleWriteIfRetargeted` can synchronize a retargeted thread and avoid cross-surface state divergence.
- `apps/web/src/hooks/useThreadActions.ts` — Unpin operations continue to resolve a writable thread target instead of writing to a potentially disconnected same-machine twin.
- `apps/web/src/hooks/useThreadActions.ts` — Successful unpin and settle lifecycle writes are mirrored back when retargeting occurred, preserving cross-surface and reconnect reliability.
- `apps/web/src/hooks/useThreadActions.ts` — Undoing settlement restores snooze state through the same writable-target and mirroring safeguards.
- `apps/web/src/hooks/useThreadActions.ts` — Unpin Undo retains the thread title and original pin order key so restoring the pin does not disturb the fork’s arranged sidebar order.
- `apps/web/src/hooks/useThreadActions.ts` — Settlement capability checks and unsupported errors use the actual writable environment and thread.
- `apps/web/src/hooks/useThreadActions.ts` — Optimistic settle departure animation remains active while the lifecycle mutation is in flight.
- `apps/web/src/hooks/useThreadActions.ts` — Failed or rejected settle mutations clear the departure marker and finish the undo claim, preventing stuck departing rows and stale undo state.
- `apps/web/src/hooks/useThreadActions.ts` — Settlement continues to use writable-thread retargeting and mirrored lifecycle writes for disconnected same-machine twins.
- `apps/web/src/hooks/useThreadActions.ts` — Settle Undo continues restoring prior pin and snooze state, with the retained canonical implementation re-reading the writable target before restoring a snooze.
- `apps/web/src/hooks/useThreadActions.ts` — Pinned-thread reorder continues targeting the current writable thread and mirroring successful writes when retargeted, preserving T3 Pretty's disconnected-twin reliability fix.
- `apps/web/src/hooks/useThreadActions.ts` — Snooze and unsnooze mutations resolve through readWritableThreadRef so writes avoid a disconnected same-machine twin.
- `apps/web/src/hooks/useThreadActions.ts` — Successful retargeted lifecycle writes are mirrored for unsnooze operations.
- `apps/web/src/hooks/useThreadActions.ts` — Snoozing retains the optimistic thread-row departure animation.
- `apps/web/src/hooks/useThreadActions.ts` — Thrown or failed snooze mutations clear the departure marker and finish the undo action, preventing stale UI state.
- `apps/web/src/hooks/useThreadActions.ts` — Capability checks and mutation payloads use the resolved writable environment and thread.
- `apps/web/src/hooks/useThreadActions.ts` — Successful snooze writes remain mirrored when the logical thread target was retargeted to a writable same-machine twin.
- `apps/web/src/hooks/useThreadActions.ts` — Retarget mirroring also remains active for batch callers that disable individual undo toasts, avoiding lifecycle divergence between thread twins.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/chat/ChatComposer.tsx` — Integrated the parent's `expandedControlsLayout.hiddenBlockCount` handling outside the resting controls strip.
- `apps/web/src/components/chat/ChatComposer.tsx` — Integrated the parent's `iconOnlyBlockCount` calculation for both resting-strip and expanded control layouts.
- `apps/web/src/components/chat/ChatComposer.tsx` — Resting controls use iconOnlyBlockCount and data-composer-block-icon-only to progressively collapse labels to icons.
- `apps/web/src/components/chat/ChatComposer.tsx` — The responsive control wrappers and overflow menu now work outside strip mode as well as inside it.
- `apps/web/src/components/chat/ChatComposer.tsx` — Overflow menu sizing follows composerControlsInStrip, using xs in the strip and sm otherwise.
- `apps/web/src/components/chat/ChatComposer.tsx` — Hidden resting blocks retain the parent's accessibility and layout handling through aria-hidden, inert, and invisible absolute positioning.
- `apps/web/src/components/chat/ChatComposer.tsx` — Integrated `resetComposerTrigger` and `setComposerTrigger` into the memo dependency list so upstream composer-trigger behavior does not capture stale callbacks.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Parent test coverage ensuring notice details appear only when text, nested content, or positioned content cannot fit.
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — Parent ResizeObserver and MutationObserver regression coverage, including removing the details control when content fits again and avoiding self-sustaining overflow from the details icon.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Integrated the parent refactor that composes the row from the shared PULL_REQUEST_ROW_CLASS and PAGE_ROW_CLASS constants instead of duplicating the base row styling inline.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Integrated the parent's `labelClassName` for `PullRequestRowAuthor`, keeping the author label screen-reader-only at the smallest width and revealing it with truncation at the metadata container's `xs` breakpoint.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — Retained the parent's compatible diff-stat placement and matched-description tooltip structure within the current row component.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — Integrated upstream's removal of the obsolete pullRequestLabelColor import from pullRequestList.logic.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — The parent replacement of hand-built label markup and color-dot handling with the shared `PullRequestLabelChip` component is retained, including the default chip size.
- `apps/web/src/components/pullRequest/pullRequestChecks.test.tsx` — The parent's expanded documentation explaining that the row-flattening helper traverses React elements supplied through props as well as children.
- `apps/web/src/hooks/useThreadActions.ts` — Integrated the parent `clearComposerDraftForThread` selector from the composer draft store alongside the fork setting.
- `apps/web/src/hooks/useThreadActions.ts` — Invalidate stale settle undo state before performing a manual unsettle.
- `apps/web/src/hooks/useThreadActions.ts` — Invalidate stale pin undo state before performing a pin mutation.
- `apps/web/src/hooks/useThreadActions.ts` — Integrated the parent’s settlement Undo workflow, including snapshots of prior pin and snooze state and restoration after unsetting.
- `apps/web/src/hooks/useThreadActions.ts` — Integrated invalidation of stale pin and snooze Undo claims when settlement supersedes those actions.
- `apps/web/src/hooks/useThreadActions.ts` — Integrated visited-state marking based on the thread wake time after a successful settlement.
- `apps/web/src/hooks/useThreadActions.ts` — Integrated the parent’s silent batch-settlement option via opts.undoToast.
- `apps/web/src/hooks/useThreadActions.ts` — Integrated the parent’s failure handling for settlement mutations and Undo restoration steps.
- `apps/web/src/hooks/useThreadActions.ts` — Retained the parent unpin Undo toast and action-claim lifecycle around the fork’s retarget-safe mutation path.
- `apps/web/src/hooks/useThreadActions.ts` — The settle callback now uses the complete upstream dependency list rather than the obsolete base dependency on only unpinThreadMutation.
- `apps/web/src/hooks/useThreadActions.ts` — The upstream canonical settle implementation is retained, including freshly resolving the writable target before restoring a snooze during Undo.
- `apps/web/src/hooks/useThreadActions.ts` — Pinned-thread reordering invalidates any pending pin Undo before applying a new order, as introduced upstream.
- `apps/web/src/hooks/useThreadActions.ts` — Unsnooze invalidates an existing snooze undo entry and sends the user-initiated unsnooze mutation.
- `apps/web/src/hooks/useThreadActions.ts` — Snooze retains the optional undoToast flag used by batch callers to suppress individual undo notifications.
- `apps/web/src/hooks/useThreadActions.ts` — When undoToast is false after a successful snooze, the undo action is finished and the mutation result is returned without creating a per-thread undo toast.
- `apps/web/src/hooks/useThreadActions.ts` — Upstream snooze capability checks, client-side snooze invariants, and undo lifecycle remain compatible with the fork implementation.
- `apps/web/src/hooks/useThreadActions.ts` — Snoozing continues to show the upstream confirmation toast with the formatted wake time, thread title, undo callback, and failure title.
- `apps/web/src/hooks/useThreadActions.ts` — Batch callers using undoToast=false still finish the undo claim and return without showing a per-thread toast.

## Parent changes intentionally omitted

- `apps/web/src/components/Sidebar.tsx` — Upstream retained the legacy secondary title and metadata rows and changed branch rendering from a tail-truncated span to MiddleTruncate.. Reason: T3 Pretty deliberately removed this entire legacy block as part of its custom sidebar-row redesign. Restoring it would duplicate title and thread metadata beneath the fork's current row content. The MiddleTruncate change cannot be applied at this deleted boundary without inventing an unrelated target elsewhere in the fork layout.
- `apps/web/src/components/chat/ChatComposer.tsx` — Always render restingBlockDefs and the measured overflow container, including when composerControlsCompact is true.. Reason: That portion would remove T3 Pretty's authoritative dedicated compact/touch-friendly composer layout. The parent responsive implementation is retained for every non-compact layout instead.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — The parent version relies entirely on the shared row class for grid-column sizing and removes the page-row-specific three-column override.. Reason: That would regress T3 Pretty's narrow-list overlap fix by no longer guaranteeing a separate trailing column for the diff stat.
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — The parent side sets `metaClassName` to only `@container/pr-row-meta`, dropping `overflow-hidden`.. Reason: Dropping overflow containment would regress T3 Pretty's explicit narrow-list protection and allow pull-request metadata to overlap the diff stat.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — The parent's borderless `className="max-w-48"` presentation for pull-request label chips.. Reason: Applying it would remove T3 Pretty's fork-specific bordered label styling; the parent component behavior is otherwise fully preserved.
- `apps/web/src/hooks/useThreadActions.ts` — The parent comment states that a merged pull request is an auto-settle trigger.. Reason: T3 Pretty deliberately stopped auto-settling threads merely because a pull request merged; retaining that wording would contradict the fork's authoritative lifecycle behavior.
- `apps/web/src/hooks/useThreadActions.ts` — The parent pin path directly returns `pinThreadMutation` using `target.environmentId`.. Reason: That direct path bypasses T3 Pretty's writable-target resolution and successful-write mirroring, regressing the fork safeguard for disconnected same-machine twins. The parent undo invalidation is retained around the fork-safe mutation path.
- `apps/web/src/hooks/useThreadActions.ts` — Directly issuing unpin, settle, and snooze-restoration mutations against target.environmentId and target.threadId.. Reason: Those references may identify a disconnected same-machine twin. They were replaced with T3 Pretty’s writable-target routing and mirrored lifecycle writes to avoid regressing established cross-surface reliability.
- `apps/web/src/hooks/useThreadActions.ts` — The upstream reorder hunk directly returns a mutation addressed to target.environmentId and target.threadId.. Reason: That literal dispatch would bypass T3 Pretty's writable-target selection and eliminate the existing post-success mirror path, regressing the fork's fix for disconnected same-machine twins. The upstream reorder behavior and pin-undo invalidation are retained through the fork-compatible writable target instead.
- `web-typecheck` failed after merging `v0.0.43-nightly.20260921.2044`; repaired with `gpt-5.6-sol`: The typecheck failure is resolved by deleting only the duplicate function implementation. Suggestion-level diagnostics are intentionally left unchanged.
  - edited `apps/web/src/components/chat/ComposerBannerStack.tsx`

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.43-nightly.20260922.2083`
- Previously integrated parent nightly: `v0.0.43-nightly.20260921.2071`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/app.config.ts` — T3 Pretty mobile versions continue to come from resolveMobileAppVersion(), keeping binaries and the in-app changelog aligned with the fork's release train instead of the parent's static mobile version.
- `apps/mobile/app.config.ts` — T3 Pretty's pinnedRuntimeVersion remains authoritative when configured, protecting the fork-owned OTA boundary from runtime fingerprint drift.
- `apps/mobile/app.config.ts` — Development continues to avoid expensive native-project fingerprint calculation, while preview and production use the configured fingerprint policy when no explicit runtime pin is present.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Kept the `useAtomSet` and `useAtomValue` imports added by T3 Pretty for its atom-backed mobile task-flow preferences and state handling.
- `apps/web/src/components/chat/MessageCopyButton.tsx` — Preserved caller-configurable copy labels for reuse across message-copy surfaces.
- `apps/web/src/components/chat/MessageCopyButton.tsx` — Preserved accessible “Copied” feedback in both the button aria-label and tooltip after a successful copy.
- `apps/web/src/hooks/useHandleNewThread.ts` — Preserved `resolveSidebarScopedProjectRef`, which supports creating new threads in the project selected by the filtered T3 Pretty sidebar.
- `packages/contracts/src/t3ProjectFile.ts` — Preserved T3 Pretty's shared maximum-length constants for project script names, commands, and preview URLs, retaining the fork's schema hardening and validation behavior.
- `packages/contracts/src/t3ProjectFile.ts` — Preserved the existing ProjectScriptIcon and ThreadEnvMode integrations.

## Parent changes integrated at conflict boundaries

- `apps/mobile/app.config.ts` — Retained the parent's runtimeVersion policy behavior as the fallback beneath T3 Pretty's explicit pinned runtime version support.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Removed the legacy `isDefaultThreadEnvModeSettled` and `resolveDefaultThreadEnvMode` imports as done by the newest parent implementation.
- `apps/web/src/components/chat/MessageCopyButton.tsx` — Integrated the parent’s corrected “Copy message” wording through the component’s existing default label, replacing the older “Copy link” and “Copy to clipboard” defaults.
- `apps/web/src/hooks/useHandleNewThread.ts` — Adopted the parent runtime's `readT3ProjectFile` API in place of the older specialized `readT3ProjectFileDefaultThreadEnvMode` import.
- `packages/contracts/src/t3ProjectFile.ts` — Integrated the upstream WorktreeSubmodules environment schema import used by the new t3.json worktree-submodule configuration.
- `packages/contracts/src/t3ProjectFile.ts` — Integrated upstream type-only imports for ProjectScopedServerSettingKey and ServerSettings so the parent project-scoped settings schema/API changes remain available.

## Parent changes intentionally omitted

- `apps/mobile/app.config.ts` — Change the mobile app's static version from 1.2.1 to the parent release version 1.3.0.. Reason: T3 Pretty intentionally derives its mobile app version from its own release train via resolveMobileAppVersion(); adopting the parent's static version would regress fork release identity and changelog versioning.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.43-nightly.20260922.2096`
- Previously integrated parent nightly: `v0.0.43-nightly.20260922.2083`
- Conflict resolver: manual repair by Cloud Agent (Grok) after Buildkite #2707. CLIProxyAPI (`gpt-5.6-sol`) returned HTTP 429 `usage_limit_reached` / `model_cooldown` and was not used.

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/AppSidebarLayout.tsx` — Preserved the workspace sidebar glass treatment and `group-data-[side=left]:border-r-0` so the project rail, not a parent border, owns the seam.
- `apps/web/src/components/AppSidebarLayout.tsx` — Preserved the memoized `sidebarResizable` options, including live `getCssWidth` / `maxWidth` getters resolved at drag time.
- `apps/web/src/components/NoActiveThreadState.tsx` — Preserved `overflow-clip` / `overflow-x-clip` and explicit `bg-background text-foreground` on empty-thread chrome.
- `apps/web/src/components/NoProjectsHero.tsx` — Preserved the same clip/background contract on the first-run empty project hero.
- `apps/web/src/components/Sidebar.tsx` — Preserved the redesigned search-result list close and empty-search status; the parent hunk that landed here was a misaligned duplicate of the nest-aware thread list already present below.
- `apps/web/src/components/pullRequest/PullRequestCodeTab.tsx` — Preserved `data-pull-request-tab-scroll="code"` on the toolbar scroller so panel view restoration still finds the Code tab.
- `apps/web/src/components/pullRequest/PullRequestReviewForm.tsx` — Preserved environment-scoped `pullRequestReviewKey` / `usePendingReviewComments` so drafts stay isolated across same-host checkouts on different environments.
- `apps/web/src/components/pullRequest/PullRequestReviewForm.tsx` — Preserved thrown-error toasts around submit so a rejected host call still explains the failure.
- `apps/web/src/components/settings/SettingsSidebarNav.tsx` — Preserved footer inset padding and `data-sidebar-peek="copy"` for the settings rail.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Preserved footer inset padding and `empty:hidden` so an idle chrome footer adds no extra space.
- `apps/web/src/components/usage/UsagePage.tsx` — Preserved `overflow-clip` and explicit page background/foreground classes.
- `apps/web/src/hooks/useThreadActions.ts` — Preserved `readWritableThreadRef` targeting, optimistic departure-marker cleanup, and retargeted lifecycle mirroring for settle and snooze.
- `apps/web/src/hooks/useThreadActions.ts` — Preserved the optional `undoToast: false` batch-silence flag on settle and snooze.
- `apps/web/src/routes/_chat.index.tsx` — Preserved clip overflow and background classes on the draft-start error and hosted onboarding empty states.
- `apps/web/src/routes/_chat.pull-requests.tsx` — Preserved clip overflow and background classes on the pull-request page shell.
- `apps/web/src/routes/settings.tsx` — Preserved clip overflow and background classes on the settings shell.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Mounted `SidebarThreadUndoNotice` in the chrome footer so settle/snooze/unpin/archive confirmations live in the sidebar.
- `apps/web/src/components/usage/UsagePage.tsx` — Added the parent's `isolate` stacking context on the usage inset.
- `apps/web/src/routes/settings.tsx` — Added the same `isolate` stacking context on the settings inset.
- `apps/web/src/components/pullRequest/PullRequestCodeTab.tsx` — Dropped the Code-tab review overlay; the parent `PullRequestComposer` now owns comment and review.
- `apps/web/src/components/pullRequest/PullRequestReviewForm.tsx` — Adopted the parent form (verdict select + single submit, parent-owned pending) as the first-party replacement for `PullRequestReviewBar`.
- `apps/web/src/hooks/useThreadActions.ts` — Replaced toast-based undo with `showThreadUndoNotice` while keeping Pretty's writable-target and departure-animation contract.

## Parent changes intentionally omitted

- `apps/web/src/components/AppSidebarLayout.tsx` — Replace the glass sidebar with `border-r border-sidebar-border` and an inline resizable object using a static `sidebarMaximumWidth`.. Reason: That would regress T3 Pretty's rail-owned seam, glass treatment, and drag-time CSS width/max-width getters.
- `apps/web/src/components/NoActiveThreadState.tsx` — Switch empty-thread overflow from `overflow-clip` / `overflow-x-clip` to `overflow-hidden` / `overflow-x-hidden` and drop explicit background/foreground classes.. Reason: T3 Pretty's scenery/layout contract (and its tests) require clip overflow on these inset shells.
- `apps/web/src/components/NoProjectsHero.tsx` — The same parent overflow-hidden / dropped-background change.. Reason: Same clip-overflow contract as the other empty inset shells.
- `apps/web/src/components/Sidebar.tsx` — A second copy of the non-search thread list and empty-state rendering spliced into the search-results close.. Reason: That hunk is a misaligned duplicate of the nest-aware list already rendered after the search branch. Restoring it would duplicate rows.
- `apps/web/src/components/settings/SettingsSidebarNav.tsx` — Drop footer inset padding and the peek-copy marker.. Reason: Those classes are part of T3 Pretty's settings-rail density and peek behavior.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Drop footer inset padding and `empty:hidden`.. Reason: That would add idle padding and regress the compact chrome footer.
- `apps/web/src/components/usage/UsagePage.tsx` — Use `overflow-hidden` instead of `overflow-clip` and drop explicit background/foreground classes.. Reason: Clip overflow and page colors are T3 Pretty's inset contract; the parent's `isolate` is kept beside them.
- `apps/web/src/hooks/useThreadActions.ts` — Call settle/snooze against `target.environmentId` / `target.threadId` and drop writable retargeting, departure cleanup, mirrored writes, and the batch `undoToast` flag.. Reason: Those references may identify a disconnected same-machine twin, and dropping the batch flag would break callers that silence per-thread notices.
- `apps/web/src/routes/_chat.index.tsx` — Switch draft-error and hosted-onboarding insets to `overflow-hidden` / `overflow-x-hidden` without background classes.. Reason: Same clip-overflow contract as the other empty inset shells.
- `apps/web/src/routes/_chat.pull-requests.tsx` — Switch the pull-request page inset to `overflow-hidden` without background classes.. Reason: Same clip-overflow contract.
- `apps/web/src/routes/settings.tsx` — Switch the settings inset to `overflow-hidden` without background classes.. Reason: Same clip-overflow contract; the parent's `isolate` is kept beside Pretty's classes.
- `.github/workflows/ci.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned

## Post-merge repairs

- `WorktreeSetupCard` — The running `Spinner` now uses the same shared `StageIcon` className as idle/done/failed/warning so caller size and stroke still apply while a step is in flight.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.43-nightly.20260922.2110` (`aff9318bf`, `fix(web): retry failed attachment uploads after reconnect (#10338)`)
- Previously integrated parent nightly: `v0.0.43-nightly.20260922.2096`
- Conflict resolver: manual repair by Cloud Agent (Grok) after Buildkite #2712. CLIProxyAPI (`gpt-5.6-sol`) returned HTTP 429 `usage_limit_reached` / `model_cooldown` (resets_at unix 1790449245, ~Sat Sep 26 12:00 PT) and was not used. Same blocker as #2707 / Origin #657.
- Merge base vs Origin `main` (`889f22cf1`): `0141bc2bf`. Origin #657 squash-merged 2096, so 2096 is not an ancestor of `main` and the 15 text conflicts from that nightly replayed. `v0.0.43-nightly.20260922.2096..2110` touches none of those paths (only the three attachment-queue files below).

## Conflicted paths

Content: `AppSidebarLayout.tsx`, `NoActiveThreadState.tsx`, `NoProjectsHero.tsx`, `Sidebar.tsx`, `WorktreeSetupCard.tsx`, `PullRequestCodeTab.tsx`, `SettingsSidebarNav.tsx`, `SidebarChrome.tsx`, `UsagePage.tsx`, `useThreadActions.ts`, `_chat.index.tsx`, `_chat.pull-requests.tsx`, `settings.tsx`.

Add/add: `PullRequestComposer.tsx`, `PullRequestReviewForm.tsx` (parent also renamed/deleted `PullRequestReviewBar.tsx`; Pretty already completed that rename on #657).

Resolution for every conflicted path: keep Pretty `main` (OURS / Origin #657 tree). Parent 2110 is byte-identical to 2096 on these files; taking THEIRS would regress the #657 contract.

`.github/workflows/*` was restored from `origin/main` after the merge, matching `scripts/fork/run-upstream-sync.sh`.

## Clean-merged parent changes (no text conflict)

- `apps/web/src/lib/attachmentUploadQueue.ts` — After a socket reconnect, wait for the in-flight upload job to settle, then `retryAttachmentUpload` if that job still owns the file and the upload is failed. Covers the case where the HTTP failure arrives after the socket has already reconnected.
- `apps/web/src/lib/attachmentUploadQueue.test.ts` — Coverage for that reconnect retry.
- `apps/mobile/src/lib/composerAttachmentUploadQueue.test.ts` — Matching mobile coverage. Pretty did not diverge on these three files.

## Post-merge repairs

- `attachmentUploadQueue` — Origin review on #658: only one reconnect edge may schedule a post-settle retry (`retryScheduled`), and replacing a map entry always stops the previous connection watcher. Two reconnects before the HTTP attempt finishes must not both call `retryAttachmentUpload`.

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/AppSidebarLayout.tsx` — Workspace sidebar glass treatment, `group-data-[side=left]:border-r-0`, and memoized `sidebarResizable` options with live `getCssWidth` / `maxWidth` getters.
- `apps/web/src/components/NoActiveThreadState.tsx` — `overflow-clip` / `overflow-x-clip` and explicit `bg-background text-foreground` on empty-thread chrome.
- `apps/web/src/components/NoProjectsHero.tsx` — Same clip/background contract on the first-run empty project hero.
- `apps/web/src/components/Sidebar.tsx` — Redesigned sidebar (project folders, nest-aware list, Pretty search-result close). Parent's search-close hunk is a misaligned duplicate of the nest-aware list already rendered below.
- `apps/web/src/components/chat/WorktreeSetupCard.tsx` — Running `Spinner` keeps the shared `StageIcon` `className` (`size-4 shrink-0 stroke-[1.8]`) so caller size and stroke still apply in flight.
- `apps/web/src/components/pullRequest/PullRequestCodeTab.tsx` — `data-pull-request-tab-scroll="code"`, `usePaintedAppearance`, environment-scoped review keys, and Pretty finding-destination / per-reference pending-thread state.
- `apps/web/src/components/pullRequest/PullRequestComposer.tsx` — Environment-scoped `pullRequestReviewKey` / `usePendingReviewComments` so drafts stay isolated across same-host checkouts on different environments.
- `apps/web/src/components/pullRequest/PullRequestReviewForm.tsx` — The same environment-scoped keys, plus thrown-error toasts around submit.
- `apps/web/src/components/settings/SettingsSidebarNav.tsx` — Footer inset padding and `data-sidebar-peek="copy"`.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Footer inset padding and `empty:hidden`.
- `apps/web/src/components/usage/UsagePage.tsx` — `overflow-clip` and explicit page background/foreground classes (parent `isolate` already present from #657).
- `apps/web/src/hooks/useThreadActions.ts` — `readWritableThreadRef` targeting, optimistic departure-marker cleanup, retargeted lifecycle mirroring, and the optional `undoToast: false` batch-silence flag.
- `apps/web/src/routes/_chat.index.tsx` — Clip overflow and background classes on the draft-start error and hosted onboarding empty states.
- `apps/web/src/routes/_chat.pull-requests.tsx` — Clip overflow and background classes on the pull-request page shell.
- `apps/web/src/routes/settings.tsx` — Clip overflow and background classes on the settings shell (parent `isolate` already present from #657).

## Parent changes integrated at conflict boundaries

None new versus Origin #657. The 2096 first-party replacements already on Pretty `main` were kept: `PullRequestComposer` owns comment/review, `PullRequestReviewForm` replaced `PullRequestReviewBar`, `SidebarThreadUndoNotice` in chrome, `isolate` on usage/settings insets, and `showThreadUndoNotice` instead of toast-based undo.

## Parent changes intentionally omitted

- `apps/web/src/components/AppSidebarLayout.tsx` — Replace the glass sidebar with `border-r border-sidebar-border` and an inline resizable object using a static `sidebarMaximumWidth`. Reason: that would regress T3 Pretty's rail-owned seam, glass treatment, and drag-time CSS width/max-width getters.
- `apps/web/src/components/NoActiveThreadState.tsx` — Switch empty-thread overflow from `overflow-clip` / `overflow-x-clip` to `overflow-hidden` / `overflow-x-hidden` and drop explicit background/foreground classes. Reason: T3 Pretty's scenery/layout contract requires clip overflow on these inset shells.
- `apps/web/src/components/NoProjectsHero.tsx` — The same parent overflow-hidden / dropped-background change. Reason: same clip-overflow contract.
- `apps/web/src/components/Sidebar.tsx` — Parent sidebar structure (legacy icons, search-close duplicate list, no Pretty project-folder / nest machinery). Reason: restoring it would regress the fork's sidebar redesign and duplicate rows.
- `apps/web/src/components/chat/WorktreeSetupCard.tsx` — Parent `Spinner` without the shared `StageIcon` className. Reason: that would drop caller size and stroke on the in-flight step icon.
- `apps/web/src/components/pullRequest/PullRequestCodeTab.tsx` — Parent `useTheme`, non-environment-scoped review keys, and the simpler `onFixFinding` signature. Reason: those would regress Pretty's painted appearance, environment-isolated drafts, and finding-destination hand-off.
- `apps/web/src/components/pullRequest/PullRequestComposer.tsx` — `usePendingReviewComments(reference)` / `pullRequestReviewKey(reference)` without `environmentId`. Reason: drafts would collide across same-host checkouts on different environments.
- `apps/web/src/components/pullRequest/PullRequestReviewForm.tsx` — The same unscoped keys, and submit without a thrown-error toast. Reason: environment isolation and failure explanation are fork-authoritative.
- `apps/web/src/components/settings/SettingsSidebarNav.tsx` — Drop footer inset padding and the peek-copy marker. Reason: those classes are part of T3 Pretty's settings-rail density and peek behavior.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Drop footer inset padding and `empty:hidden`. Reason: that would add idle padding and regress the compact chrome footer.
- `apps/web/src/components/usage/UsagePage.tsx` — Use `overflow-hidden` instead of `overflow-clip` and drop explicit background/foreground classes. Reason: clip overflow and page colors are T3 Pretty's inset contract; the parent's `isolate` is already kept.
- `apps/web/src/hooks/useThreadActions.ts` — Call settle/snooze/pin against `target.environmentId` / `target.threadId` and drop writable retargeting, departure cleanup, mirrored writes, and the batch `undoToast` flag. Reason: those references may identify a disconnected same-machine twin, and dropping the batch flag would break callers that silence per-thread notices.
- `apps/web/src/routes/_chat.index.tsx` — Switch draft-error and hosted-onboarding insets to `overflow-hidden` / `overflow-x-hidden` without background classes. Reason: same clip-overflow contract.
- `apps/web/src/routes/_chat.pull-requests.tsx` — Switch the pull-request page inset to `overflow-hidden` without background classes. Reason: same clip-overflow contract.
- `apps/web/src/routes/settings.tsx` — Switch the settings inset to `overflow-hidden` without background classes. Reason: same clip-overflow contract; the parent's `isolate` is already kept.
- `.github/workflows/*` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.43-nightly.20260922.2123` (`d7819c188`, `chore(devices): bump agent-device to 0.21.12 (#13124)`)
- Previously integrated parent nightly: `v0.0.43-nightly.20260922.2110`
- Conflict resolver: manual repair by Cloud Agent (Grok) after Buildkite #2767. CLIProxyAPI (`gpt-5.6-sol`) returned HTTP 429 `model_cooldown` / `usage_limit_reached` until ~Sat 2026-09-26 12:00 PT and was not used.
- Merge base vs Origin `main` (`2bcd1ecbc`): `0141bc2bf`. Origin #658 squash-merged 2110, so 2110 is not an ancestor of `main` and historical Pretty-vs-parent paths replayed. Unlike 2096..2110, `2110..2123` is a large parent delta (30 commits, 155 files): web UI primitive refactors, panel-animation settings, Opus 5.5 / model-manifest, explicit provider-refresh cache bypass, and the agent-device 0.21.12 bump.

## Conflicted paths

Replay-only (parent 2110 == 2123 on these files; kept Pretty `main` / #658 tree): `AppSidebarLayout.tsx`, `WorktreeSetupCard.tsx`, `useThreadActions.ts`, `attachmentUploadQueue.ts`, `attachmentUploadQueue.test.ts`, `settings.tsx`.

Parent-changed 2110..2123, resolved by applying that parent patch onto Pretty (or the equivalent hunks when the patch did not apply cleanly): `ChatView.tsx`, `CommandPaletteResults.tsx`, `GitActionsControl.tsx`, `NoActiveThreadState.tsx`, `NoProjectsHero.tsx`, `ProjectScriptsControl.tsx`, `Sidebar.tsx`, `ThreadStatusIndicators.tsx`, `ChatHeader.tsx`, `draftHeroTransition.ts`, `MobileClientsUserProfilePage.tsx`, `T3ConnectUserProfilePage.tsx`, `PreviewMoreMenu.tsx`, `PullRequestCodeTab.tsx`, `PullRequestCommentForm.tsx`, `PullRequestComposer.tsx`, `PullRequestReviewForm.tsx`, `BrowserImportWizard.tsx`, `ProviderInstanceCard.tsx`, `SettingsSidebarNav.tsx`, `ThemeSettings.tsx`, `SidebarChrome.tsx`, `SidebarThreadHeader.tsx`, `SidebarThreadUndoNotice.tsx`, `command.tsx`, `menu.tsx`, `UsagePage.tsx`, `_chat.index.tsx`, `_chat.pull-requests.tsx`, `lint-restyle-ceiling.ts`, `vite.config.ts`.

Add/add: `PullRequestCommentForm.tsx`, `PullRequestComposer.tsx`, `PullRequestReviewForm.tsx`, `SidebarThreadUndoNotice.tsx`, `lint-restyle-ceiling.ts`. Parent also renamed/deleted `PullRequestReviewBar.tsx`; Pretty already completed that rename.

`.github/workflows/*` was restored from `origin/main` after the merge, matching `scripts/fork/run-upstream-sync.sh`.

## Post-merge repairs

- `web-typecheck` — Restored `import { cn } from "~/lib/utils"` in `apps/web/src/components/CommandPaletteResults.tsx`. The parent `CommandItem.active` hunk dropped local highlight classes, but Pretty still wraps the submenu chevron in `cn(...)`.

## Clean-merged parent changes (no text conflict)

- `apps/server` — Explicit provider refresh bypasses owned caches (`#13109`). Claude/Cursor driver and Cursor provider layers pick up the refresh path. Model manifest adds Opus 5.5 without rewriting existing aliases (`#13094`) plus timestamp/model updates. `ws.ts` / `server.test.ts` cover the refresh and model-list behavior. Device toolchain pins agent-device 0.21.12 (`#13124`).
- `packages/contracts/src/rpc.ts` — Contract follow-through for the provider refresh / model-list work.
- `apps/web/src/components/ui/*` — Parent primitive defaults auto-merged: `ghost-muted` / `ghost-destructive`, Empty sizes, Skeleton shapes, SidebarInput, Badge label variant, tooltip wrap width, popover widths, dialog body rhythm, and related call-site cleanups.
- `apps/web/src/components/chat/ChatComposer.tsx` — Auto-merged parent panel-animation settings and `iconOnlyBlockCount` overflow while keeping Pretty compact-touch controls, Create PR / babysit, and dictation.
- `docs/internals/model-manifest.md` — Manifest documentation for the new models.

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/AppSidebarLayout.tsx` — Workspace sidebar glass treatment, `group-data-[side=left]:border-r-0`, and memoized `sidebarResizable` options with live `getCssWidth` / `maxWidth` getters.
- `apps/web/src/components/NoActiveThreadState.tsx` / `NoProjectsHero.tsx` / `UsagePage.tsx` / `_chat.index.tsx` / `_chat.pull-requests.tsx` / `settings.tsx` — `overflow-clip` / `overflow-x-clip` and explicit `bg-background text-foreground` on inset shells. Parent `isolate` stays on usage and settings.
- `apps/web/src/components/NoProjectsHero.tsx` — Pretty clip/background contract plus the parent `Empty size="hero"` API; description keeps Pretty's quieter muted tone.
- `apps/web/src/components/Sidebar.tsx` — Redesigned sidebar (project folders, nest-aware list, Pretty search-result close). Parent search-close duplicate list is not restored. Tooltip keeps `text-left whitespace-normal`. Header `SidebarGroup` keeps `relative z-[1]` so the stage backdrop does not paint the search outline.
- `apps/web/src/components/chat/ChatView.tsx` / `draftHeroTransition.ts` — Pretty scenery dock, remount handoff, glide/pop thresholds, and scenery duration/easing stay. Parent panel-animation `active` / `durationMs` now gate the non-scenery glide and the mobile composer view transition.
- `apps/web/src/components/chat/ChatHeader.tsx` — Pretty header (no parent `MenuPopup` width hunk exists on this tree).
- `apps/web/src/components/chat/WorktreeSetupCard.tsx` — Running `Spinner` keeps the shared `StageIcon` className.
- `apps/web/src/components/chat/ChatComposer.tsx` — Compact-touch menu, Create PR / babysit, dictation, and `composerControlsCompact`.
- `apps/web/src/components/clerk/*` — Pretty `SURGE_*` product names stay; parent Empty `size="compact"` / Skeleton `shape="card"` land around them.
- `apps/web/src/components/pullRequest/*` — Environment-scoped `pullRequestReviewKey` / `usePendingReviewComments`, `data-pull-request-tab-scroll="code"`, painted appearance, and thrown-error toasts. Parent 2110..2123 primitive-class cleanup is applied on that Pretty tree.
- `apps/web/src/components/settings/SettingsSidebarNav.tsx` — Footer inset padding and `data-sidebar-peek="copy"`. Search uses parent `SidebarInput` / default `Kbd`.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Footer inset padding, `empty:hidden`, and the Pretty brand-stage pill wrapper (`rounded-full` / muted).
- `apps/web/src/components/sidebar/SidebarThreadHeader.tsx` — Pretty bordered search field and `--sidebar-icon-color` placeholder; input is now `SidebarInput`.
- `apps/web/src/components/ui/command.tsx` — Pretty 90ms highlight transition kept; parent `active` prop added so the palette can own highlight.
- `apps/web/src/components/ui/menu.tsx` — Pretty `dropdown-glass` kept; parent default min/max width, truncated labels, and checkbox grid `minmax(0,1fr)`.
- `apps/web/src/hooks/useThreadActions.ts` — `readWritableThreadRef`, departure-marker cleanup, retargeted lifecycle mirroring, and `undoToast: false`.
- `apps/web/src/lib/attachmentUploadQueue.ts` — #658 `retryScheduled` so two reconnect edges cannot both retry.

## Parent changes integrated at conflict boundaries

- Draft-hero / mobile composer transitions honor `usePanelAnimationSettings()` (`active` + `durationMs`) and set `--mobile-composer-transition-duration`.
- `CommandItem` gains `active`; command-palette rows use it instead of restyling highlight locally (Pretty 90ms transition stays on the primitive).
- Menu/tooltip/popover/dialog call sites drop width and `space-y-4` overrides now owned by ui defaults (`GitActionsControl`, `PreviewMoreMenu`, `ProviderInstanceCard`, `ChatView` tooltip).
- Empty uses `size="hero"` / `size="compact"`; Skeleton uses `shape="card"`.
- Settings and sidebar search use `SidebarInput`. Provider update/delete buttons use `ghost-muted` / `ghost-destructive` and `PopoverPopup width="md"`.
- `ThreadPullRequestBadgeControl` renders through `Button` / `InlineButton` `render={element}` with `MouseEvent<HTMLElement>` so stack buttons and anchors share one handler type. Pretty underline variant classes stay on the non-ghost path.
- `vite.config.ts` exempts `CollapsibleTrigger` from `shadcn/no-restyle` (parent `#13024`).
- Pull-request composer/review/code/comment forms take the small 2110..2123 primitive cleanups on top of Pretty environment scoping.

## Parent changes intentionally omitted

- `scripts/lint-restyle-ceiling.ts` — Lower `RESTYLE_CEILING` from 1207 to 628. Reason: that drop matches the parent's migrated call sites. Pretty still owns extra chrome restyles, so taking 628 would fail the fork gate. Keep 1207 until a Pretty-side count is measured.
- `apps/web/src/components/AppSidebarLayout.tsx` — Replace the glass sidebar with `border-r border-sidebar-border` and an inline resizable object using a static `sidebarMaximumWidth`. Reason: that would regress T3 Pretty's rail-owned seam, glass treatment, and drag-time CSS width/max-width getters.
- `apps/web/src/components/NoActiveThreadState.tsx` / `NoProjectsHero.tsx` / `UsagePage.tsx` / `_chat.index.tsx` / `_chat.pull-requests.tsx` / `settings.tsx` — Switch inset overflow to `overflow-hidden` and drop explicit background/foreground classes. Reason: T3 Pretty's scenery/layout contract requires clip overflow on these inset shells.
- `apps/web/src/components/Sidebar.tsx` — Parent sidebar structure (legacy icons, search-close duplicate list, no Pretty project-folder / nest machinery) and dropping `relative z-[1]` / `text-left whitespace-normal` tooltip classes. Reason: restoring parent structure would regress the redesign; the z-index and tooltip wrapping remain Pretty chrome.
- `apps/web/src/components/chat/ChatView.tsx` — Replace Pretty scenery handoff/glide with the parent's single-duration draft-hero hook. Reason: scenery dock motion is fork-authoritative; parent panel-animation gating is applied around it.
- `apps/web/src/components/chat/ChatHeader.tsx` — Drop `className="min-w-56 max-w-[calc(100vw-2rem)]"` on a header actions `MenuPopup`. Reason: Pretty's header has no such menu; there is no equivalent call site.
- `apps/web/src/components/settings/ThemeSettings.tsx` — Switch a theme-library remove button to `ghost-destructive`. Reason: Pretty's ThemeSettings has no matching remove control at that boundary.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Drop `rounded-full` / muted classes from the environment identification pill. Reason: those are Pretty brand-stage chrome; footer `empty:hidden` is also kept.
- `apps/web/src/hooks/useThreadActions.ts` — Call settle/snooze/pin against `target.environmentId` / `target.threadId`. Reason: those references may identify a disconnected same-machine twin.
- `.github/workflows/*` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.43-nightly.20260923.2135` (`aca3c87cd`, `chore(mobile): clear the legacy-list deletion fallout (#13203)`)
- Previously integrated parent nightly: `v0.0.43-nightly.20260922.2123`
- Conflict resolver: manual repair by Cloud Agent (Grok) after Buildkite #2785. CLIProxyAPI (`gpt-5.6-sol`) returned HTTP 429 `model_cooldown` / `usage_limit_reached` and was not used. Same Sol cooldown that blocked #2767 / nightly 2123 and Origin #681.
- Merge base vs Origin `main` (`c7f10af23`): `d7819c188` (2123). Origin #681 merge-committed 2123, so 2123 is an ancestor of `main`. Conflicts are the 25 Pretty-divergent paths parent 2123..2135 also touched — not a squash-merge replay.

## Conflicted paths

Content: `apps/mobile/package.json`, `HomeHeader.tsx`, `HomeRouteScreen.tsx`, `HomeScreen.tsx`, `home-list-options.ts`, `ThreadNavigationSidebar.tsx`, `ThreadRouteScreen.tsx`, `ThreadSettingsSheet.tsx`, `GitBranchesSheet.tsx`, `GitCommitSheet.tsx`, `mobile-preferences.ts`, `thread-outbox-model.ts`, `Sidebar.tsx`, `ThreadStatusIndicators.tsx`, `ProviderInstanceCard.tsx`, `settingsLayout.tsx`, `packages/contracts/src/model.ts`, `packages/contracts/src/server.ts`, `packages/contracts/src/settings.test.ts`, `scripts/lint-restyle-ceiling.ts`.

Modify/delete (deleted upstream, modified on Pretty): `home-list-options.test.ts`, `homeListItems.test.ts`, `homeListItems.ts`, `thread-list-items.tsx`, `threadPresentation.ts`.

`.github/workflows/*` was restored from `origin/main` after the merge, matching `scripts/fork/run-upstream-sync.sh`.

## Post-merge repairs

- Extracted `ThreadActiveSubagentCount` from the deleted legacy `thread-list-items.tsx` into `thread-active-subagent-count.tsx` so v2 rows keep Pretty's subagent glyph after the parent list retirement.

## Clean-merged parent changes (no text conflict)

- `apps/server` — GitHub PR lookups stop probing owner-qualified heads (`#13200`); background PR sync reads summaries in batches (`#13198`); background PR checks spend less GitHub quota (`#13189`); PR diffs generate from branch changes (`#13170`); shared provider sign-in / credential bindings (`#12983`); remote compatibility ranges (`#13130`).
- `apps/web` — Settings scope sentence + breadcrumb move (`#13139`, `#13165`); provider email alignment (`#13174`); PR badge meta size (`#13175`); nested chat-timeline scroll (`#13167`); usage model-ordering tests without static markup (`#13104`).
- `apps/mobile` — Uniwind platform-variant refactors for git sheets and remaining className ternaries (`#13185`, `#13188`, `#13172`); recycle the default v2 home list (`#13149`); cycle-breaking extractions (`#13151`); drop dead nitro-markdown tgz override (`#13148`).
- `packages/contracts` — GPT-6 Luna as the text-generation default (`#13115`); provider setup / compatibility contract follow-through.
- `apps/desktop` — Find linuxbrew node for the WSL backend (`#7827`).

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/Sidebar.tsx` — Redesigned sidebar plus #683 in-place title/status motion (`useInPlaceChange`, keyed title, `data-sidebar-status-change`). Parent `InlineButton` PR-badge render is applied on that tree.
- `apps/web/src/components/ThreadStatusIndicators.tsx` — Pretty status icons stay; parent `useRender` / `InlineButton` badge control lands so the badge reads at the meta size.
- `apps/web/src/components/settings/settingsLayout.tsx` — Pretty chrome-fade / relative column scroller plus the parent `SettingsScopeSentence`.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — Pretty card chrome and `EnvironmentVariablesEditor`; parent `ProviderStatusDiagnostic` / compatibility warning icon land around them.
- `packages/contracts/src/model.ts` — Parent `gpt-6-luna` text-generation default; Pretty `DEFAULT_HOME_SUGGESTIONS_MODEL` (`gpt-6-astra`) stays.
- `packages/contracts/src/server.ts` — Parent `canInstallVersion`; Pretty branded `ServerProviderTimestamp` / `ServerProviderText` length bounds stay on `checkedAt` / `message`.
- `packages/contracts/src/settings.test.ts` — Pretty Luna / Astra default assertions, updated to `gpt-6-luna`.
- `apps/mobile` home/thread list — Parent retirement of the legacy grouped list is taken. Pretty PR-nesting (`nestThreadsByPullRequest`, `resolveHighestThreadStatus`) and subagent counts stay on v2. `threadPresentation.ts` is kept because v2 still imports it. Home/sidebar keep Pretty scenery, automations, `WorkspaceConnectionTitle`, and scoped `startNewTask`.
- `apps/mobile/src/persistence/mobile-preferences.ts` — Pretty auto-PR, babysit, changelog, and scenery prefs stay; the dead `legacyThreadListEnabled` key is dropped.
- `apps/mobile/src/state/thread-outbox-model.ts` — Parent `./legacy-plan-mode` move; Pretty `compareTimestamps` import stays.
- `apps/mobile` git sheets — Pretty `GitBranchesSheet` LegendList chrome; `GitCommitSheet` takes parent uniwind variants and keeps Pretty a11y `accessibilityRole` / `hitSlop`.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Pretty disclosure-row density (`px-5 py-2.5`).
- `apps/mobile/src/features/threads/ThreadRouteScreen.tsx` — Parent uniwind android canvas classes plus Pretty `SceneryBackdrop`.
- `apps/mobile/src/features/home/home-list-options.ts` — Pretty shared `selectedProjectKey` stays so home and the iPad sidebar share the project filter. Parent thread-sort API is dropped with the legacy list.

## Parent changes integrated at conflict boundaries

- Mobile legacy grouped list is gone (`#13183`, `#13203`): `homeListItems*`, `thread-list-items.tsx`, and `home-list-options.test.ts` are deleted. Home and the sidebar render v2 only.
- Text generation default is `gpt-6-luna`.
- Settings page shows `SettingsScopeSentence`.
- Provider instance cards show compatibility diagnostics.
- PR badge uses `InlineButton` / `useRender` so it reads at the meta size.
- Git commit sheet platform classes are uniwind variants.
- Dead nitro-markdown `overrides` block is dropped.
- `thread-outbox-model` imports `legacy-plan-mode` from `state/` after the parent move.

## Parent changes intentionally omitted

- `scripts/lint-restyle-ceiling.ts` — Lower `RESTYLE_CEILING` from 1207 to 627. Reason: that drop matches the parent's migrated call sites. Pretty still owns extra chrome restyles, so taking 627 would fail the fork gate.
- `apps/mobile/src/features/threads/threadPresentation.ts` — Parent deleted this with the legacy list. Reason: Pretty v2 still uses `resolveHighestThreadStatus` / `ThreadStatusPresentation` for collapsed PR nests.
- `apps/mobile/src/features/threads/git/GitBranchesSheet.tsx` — Parent replaced Pretty's LegendList with a ScrollView + uniwind restyle. Reason: Pretty owns the recycled branch list chrome; the parent restyle does not map onto that structure.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Parent `bg-card px-4 android:min-h-14` disclosure row. Reason: that would regress Pretty's compact settings-sheet density.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — Parent in-card environment-variable draft editor. Reason: Pretty already routes env vars through `EnvironmentVariablesEditor`; the unused parent helpers were not landed.
- `.github/workflows/*` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.43-nightly.20260923.2150` (`f5ef0ddb9`, `chore(mobile): bump app version to 1.3.1`)
- Previously integrated parent nightly: `v0.0.43-nightly.20260923.2135`
- Conflict resolver: manual repair by Cloud Agent (Grok) after Buildkite #2793. CLIProxyAPI (`gpt-5.6-sol`) returned HTTP 429 `model_cooldown` / `usage_limit_reached` and was not used. Same Sol cooldown that blocked #2785 / nightly 2135, Origin #686, #2767 / nightly 2123, and Origin #681.
- Merge base vs Origin `main` (`f98ea1f3b`): `aca3c87cd` (2135). Origin #686 merge-committed 2135, so 2135 is an ancestor of `main`. Conflicts are the 20 Pretty-divergent paths parent 2135..2150 also touched — not a squash-merge replay.

## Conflicted paths

Content: `apps/mobile/app.config.ts`, `AdaptiveWorkspaceLayout.tsx`, `ThreadDetailScreen.tsx`, `ThreadRouteScreen.tsx`, `thread-inspector-content-stack.tsx`, `AppSidebarLayout.tsx`, `GitActionsControl.tsx`, `Sidebar.tsx`, `ChatComposer.tsx`, `CompactComposerControlsMenu.tsx`, `DraftHeroHeadline.tsx`, `PullRequestReviewAnnotation.tsx`, `PullRequestSummaryTab.tsx`, `ConnectionsSettings.tsx`, `SettingsSidebarNav.tsx`, `SidebarThreadHeader.tsx`, `button.tsx`, `toggle.tsx`, `index.css`.

Modify/delete: `scripts/lint-restyle-ceiling.ts` (parent deleted it; Pretty modified it). Kept Pretty's script at `RESTYLE_CEILING` 1207. Restored `scripts/lint-restyle-ceiling.test.ts` and `package.json` `lint:restyle-ceiling`. Left `shadcn/no-restyle` as warn in `vite.config.ts` (parent made it an error).

`.github/workflows/*` was restored from `origin/main` after the merge, matching `scripts/fork/run-upstream-sync.sh`.

## Post-merge repairs

- `AGENTS.md` Taste — Restored Pretty's "`shadcn/no-restyle` reports violations and CI caps their count" wording. The parent nightly auto-merged "fails lint on violations", which contradicted the kept warn + ceiling gate (Origin review on #688).

## Clean-merged parent changes (no text conflict)

- `apps/web` — Context chips through one `ContextChip` (`#13192`); ui components drop secondary className props (`#13193`); menu/field/sidebar/button consumers stop restyling primitives (`#13205`–`#13208`); composer controls own their look (`#13209`); title matches sort by recent activity (`#13219`); `mod+[` / `mod+]` history navigation (`#13212`).
- `apps/mobile` — Recover from screen render errors (`#13197`); app version bump is ignored in favor of Pretty's release-train resolver.
- `apps/desktop` — Remove redundant keyring module-load test (`#13220`).
- `packages/contracts` / `packages/shared` — `navigation.back` / `navigation.forward` keybindings.
- `apps/web/src/components/ui/sheet.tsx` / `previewMiniPlayerLayout.ts` — docked sheets sit at `--z-sheet` under the mini-player and dialogs.

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/app.config.ts` — `resolveMobileAppVersion()` and `pinnedRuntimeVersion` stay. Parent static `1.3.1` is not taken.
- `apps/mobile` inspector/home — Pretty ReactNode `files`/`git`/`route` inspector API, visibility context, `AdaptiveWorkspaceSidebarNewTaskLayout`, PR/automations/rename sidebar handlers, scenery canvas, and `liveHeadline` stay. Parent `RenderErrorBoundary` wraps those trees and `resetKeys` follow the thread/cwd.
- `apps/web/src/components/AppSidebarLayout.tsx` — Workspace sidebar glass, `group-data-[side=left]:border-r-0`, memoized `sidebarResizable` with live CSS width/max-width getters, and macOS `SidebarControl` props stay. Parent `NavigationHistoryShortcuts` is mounted beside them. Stage artwork uses parent `media-navigation` instead of restyling the trigger SVG.
- `apps/web/src/components/Sidebar.tsx` — Redesigned sidebar (project folders, nest-aware list, Pretty search/tooltip chrome). Parent snooze control is now a `Menu` (`SnoozeMenuButton`) on that tree.
- `apps/web/src/components/chat/ChatComposer.tsx` — Compact-touch menu, Create PR / babysit, dictation, `tesla-touch` snap-shot reveal. Parent `ComposerControl` / `media-close` / `overlay` attachment buttons land around them.
- `apps/web/src/components/chat/CompactComposerControlsMenu.tsx` — Pretty `ghost` variant and size-aware padding stay.
- `apps/web/src/components/chat/DraftHeroHeadline.tsx` — Pretty `PullRequestGlyph` stays; parent `InlineButton tone="picker"` trigger and radio-item wrap land beside it.
- `apps/web/src/components/pullRequest/*` — Pretty host-link / glyph / environment-scoped review chrome stay. Parent `PullRequestActorLabel variant="avatar"` and dropped button restyles apply on that tree.
- `apps/web/src/components/settings/SettingsSidebarNav.tsx` / `SidebarThreadHeader.tsx` / `ConnectionsSettings.tsx` — Pretty rail density, bordered search, peek-copy, and compact add-environment chrome stay. Parent dropped a few Autocomplete restyles in Connections.
- `apps/web/src/components/ui/button.tsx` / `toggle.tsx` — Pretty color/opacity/scale transitions stay; parent `aria-disabled` opacity (and button cursor) is added.
- `apps/web/src/index.css` — Pretty `--glass-blur-raised` stays; parent `--z-sheet: 46` is added beside it. Parent markdown file-link / chrome-action token cleanup auto-applied.

## Parent changes integrated at conflict boundaries

- Mobile render-error recovery on the conversation feed, inspector panes, and iPad sidebar.
- Web history shortcuts `navigation.back` / `navigation.forward` (`mod+[` / `mod+]`).
- Composer attachment close buttons use `media-close` / `overlay` variants instead of restyling `ghost`.
- Draft hero project picker uses `InlineButton tone="picker"`.
- Sidebar snooze presets render through `Menu` / `MenuShortcut`.
- Pull-request actor stacks use `variant="avatar"`.
- Git commit-dialog file list puts height on a wrapper so `ScrollArea` is not restyled; quick-action button drops `ps-[8.5px]`.
- Button/Toggle honor `aria-disabled`.
- `--z-sheet` token for docked sheets.

## Parent changes intentionally omitted

- `scripts/lint-restyle-ceiling.ts` — Parent deleted the ceiling gate and made `shadcn/no-restyle` an error. Reason: Pretty still owns extra chrome restyles; taking the deletion or the error rule would fail the fork lint/ceiling gate. Keep the script at 1207 and `no-restyle` as warn. Parent `RESTRICTED_UI_VARIANT_PATTERNS` (do not borrow `buttonVariants` in app code) is kept.
- `apps/mobile/app.config.ts` — Change the mobile app's static version from 1.3.0 to 1.3.1. Reason: T3 Pretty derives its mobile version from its own release train via `resolveMobileAppVersion()`.
- `apps/web/src/components/AppSidebarLayout.tsx` — Replace the glass sidebar with an inline resizable object and a no-prop `SidebarControl`. Reason: that would regress T3 Pretty's rail-owned seam, drag-time CSS width getters, and macOS traffic-light control.
- `apps/web/src/components/chat/CompactComposerControlsMenu.tsx` — Drop `variant="ghost"` and the xs/default padding split. Reason: those are Pretty compact-touch chrome; `ComposerControl` already owns the look.
- `apps/web/src/components/sidebar/SidebarThreadHeader.tsx` / `SettingsSidebarNav.tsx` — Parent `ghost-muted` clear buttons and header restyle. Reason: Pretty owns the bordered search field, peek-copy rail, and pointer-coarse header hit targets.
- `apps/web/src/components/settings/ConnectionsSettings.tsx` — Parent `ghost-muted` header actions. Reason: Pretty's add-environment control keeps compact `h-5` / `text-[11px]` chrome.
- `.github/workflows/*` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned.
