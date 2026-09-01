# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260820.1142`
- Previously integrated parent nightly: `v0.0.34-nightly.20260819.1133`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/desktop/src/updates/DesktopUpdates.ts` — T3 Pretty's failed-install recovery continues to run when electron-updater reports an install error, including recovery of backend instances recorded in installRecoveryInstancesRef.
- `apps/desktop/src/updates/DesktopUpdates.ts` — The install-specific compatibility ref required by the existing recovery routine is retained while the parent action reservation remains authoritative.
- `apps/desktop/src/updates/DesktopUpdates.ts` — Desktop lifecycle recovery remains complete before the failed install is exposed as available for another updater action.
- `apps/server/src/orchestration/ActivityPayloadProjection.ts` — Retained `activityProjectionGroupKey` as the authoritative fallback for lifecycle identity, preserving T3 Pretty's centralized activity grouping and action-identity behavior.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` — Preserved T3 Pretty's existing `status` propagation for completed tool lifecycle activities and left its surrounding tool payload behavior unchanged.
- `apps/server/src/provider/Layers/OpenCodeProvider.test.ts` — Preserved T3 Pretty commit 359573a76's intentional removal of the unused OpenCode provider and its obsolete provider-specific test file.
- `apps/server/src/provider/Layers/OpenCodeProvider.ts` — Preserved T3 Pretty commit 359573a76's intentional removal of the unused OpenCode provider implementation.
- `apps/server/src/provider/opencodeRuntime.cliParsers.test.ts` — Preserved T3 Pretty's explicit removal of the unused OpenCode provider and its associated dead runtime-parser test file.
- `apps/server/src/provider/opencodeRuntime.ts` — T3 Pretty's explicit removal of the unused OpenCode provider and its server/runtime integration, as established by commit 359573a76.
- `apps/web/src/components/ChatView.tsx` — T3 Pretty's titlebar transition continues to animate both padding sides, keeping native titlebar controls visually still while the right panel slides.
- `apps/web/src/components/ChatView.tsx` — Reduced-motion users continue to receive no titlebar padding transition.
- `apps/web/src/components/ChatView.tsx` — The collapsed-sidebar titlebar inset class remains applied.
- `apps/web/src/components/ComposerPromptEditor.tsx` — Preserved T3 Pretty composer @app mention lookup and rendering through getComposerAppMention, useComposerAppMention, and AppIcon.
- `apps/web/src/components/chat/ChatComposer.tsx` — ThreadSubagentPolicy remains imported for T3 Pretty's global and per-thread subagent policy behavior.
- `apps/web/src/components/chat/ChatComposer.tsx` — Skill mention token generation remains available for T3 Pretty's composer skill picker and $use mention flow.
- `apps/web/src/components/chat/ChatComposer.tsx` — The data-chat-composer-editor-chrome hook remains on the composer surface for T3 Pretty styling and presentation.
- `apps/web/src/components/chat/ChatComposer.tsx` — Canvas selection cards remain visible and removable, with image expansion behavior preserved.
- `apps/web/src/components/chat/ChatComposer.tsx` — Images represented by canvas selections remain excluded from the generic attachment grid to prevent duplicate cards.
- `apps/web/src/components/chat/ChatComposer.tsx` — The composer placeholder continues advertising @app mentions with “@tag files or apps,” preserving T3 Pretty's external Apps/T3 Connect composer UX.
- `apps/web/src/components/chat/ChatComposer.tsx` — T3 Pretty's consolidated ComposerOverflowMenu remains available in both compact and expanded footer layouts, including provider-aware interaction/runtime controls, provider traits, thread overflow content, and skills-picker close handling.
- `apps/web/src/components/chat/ChatComposer.tsx` — The fork-only auto-create pull-request toggle remains exposed through the composer overflow menu.
- `apps/web/src/components/chat/ChatComposer.tsx` — The primary action continues to use turnInProgress rather than only phase === "running", preserving continuous thinking/running feedback while a new thread starts.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Pretty's @ menu remains capable of presenting Files, Skills, and Apps as distinct groups, with a header omitted when only one @ result kind is present.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Pretty's slash menu retains Built-in and Provider sections, and runtime-mode entries remain part of the Built-in section.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Pretty's dedicated Skills section and skill-aware empty-state presentation remain intact.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Pretty app mentions retain their branded AppIcon rendering with app name, color, and icon domain.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Pretty's runtime-mode icons, bot icon for built-in slash commands, and provider-command glyph remain visible.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — The optional slash-section control is restored around the parent component refactor and defaults to preserving Pretty's grouped slash-menu behavior.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Neutral work-entry status classification remains available alongside the parent failure API.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Pretty's compact turn-fold typography, spacing, hover treatment, and transition timing are retained.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Pretty's status-pulse-wave working animation and compact working-row presentation are retained.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Pretty's compact work-group toggle styling, custom chevron easing, hover opacity, and reduced-motion safeguard are retained.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Skill-load timeline entries retain the Package icon and package icon-name support.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Generated-image timeline entries retain their dedicated Image icon, timeline row context, activity binding, generated path resolution, and pending lifecycle handling.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Pretty's structured tool-call display remains authoritative, including resolved/raw command presentation, MCP data, output and changed-file sections, command formatting/highlighting, and structure-aware expansion.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Pretty's heading-plus-preview labels and duplicate-preview suppression remain intact.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Multiline, whitespace-sensitive, clipped, and structurally enhanced tool bodies retain the fork's disclosure safeguards.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Pretty's compact size-4 timeline icon treatment and muted handling of ordinary tool-like failures remain intact instead of turning every failed tool into a large destructive X.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Legacy icon fallbacks remain available for tool entries not classified by the new upstream action mapper.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Pretty's compact tool-row visual design, including 12px typography, foreground treatment, six-unit header height, hover/open-state styling, icon size and stroke, and custom chevron animation.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The clipping-aware split between heading and preview, including the previewRef measurement that keeps disclosure available for clipped, multiline, whitespace-sensitive, or structurally richer tool output.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Pretty's status policy: successful calls remain visually quiet, failed calls retain the explicit failed affordance, and neutral markers appear only for still-open calls during an active turn.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Header-only expansion semantics are retained, so interacting with expanded tool content or generated-image content does not inadvertently collapse the row.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Pretty's reduced-motion behavior remains attached to the disclosure chevron transition.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — The pullRequestDiffIdentity integration used by T3 Pretty's pull-request diff behavior remains imported.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Per-tab panel state survives remounts: condensed chrome is restored from saved view state, each tab retains its own chrome state, and the viewport reference remains available for scroll restoration.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Chrome condensation remains restricted to the collapse variant and retains exact scroll compensation so content does not jump while the header changes height.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — The visible Fix all button for unresolved review findings remains in the header, including its handoff guard and progress label.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Timeline-order changes continue through T3 Pretty's persistence-aware setTimelineOrder wrapper rather than bypassing or miscalling it.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — The context-independent visible “Fix all findings” label added for bulk review-finding handoff.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Resolve and conflict-resolution handoff labels for actions targeting the currently open thread.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Resolve and conflict-resolution handoff labels for actions initiated from the standalone pull-request page.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — The SourceControlProviderKind contract type remains available for T3 Pretty's provider-aware pull-request behavior, including first-class Cursor Origin handling and host-specific review guidance.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — The aggregate findings action remains visibly labeled "Fix all findings" in both current-thread and other-thread contexts.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Review-thread resolution handoff labels remain available for both current-thread and new-thread destinations.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Merge-conflict resolution handoff labels remain available for both current-thread and other-thread destinations.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Preserved the generated T3 Pretty sidebar mark (`/t3-pretty-mark.png`) and the accompanying “Pretty” identity instead of restoring the legacy inline T3 wordmark.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Preserved the fork’s existing branded sidebar header, including its stage-backdrop-aware foreground treatment.
- `apps/web/src/components/threadActionMenu.logic.test.ts` — The in-app action menu keeps copy actions nested under the top-level copy item, with the exact Pretty ordering of copy-path, conditional copy-branch, and copy-thread-id.
- `apps/web/src/components/threadActionMenu.logic.test.ts` — The copy-branch child remains conditional on the thread having a branch.
- `apps/web/src/components/threadActionMenu.logic.test.ts` — The new-thread action retains the compact label “New thread on this branch,” preventing long branch names from stretching the glass menu.
- `apps/web/src/components/threadActionMenu.logic.ts` — T3 Pretty's in-app glass menu architecture remains based on explicit lifecycle, edit, copy, and danger groups joined by synthetic separator items.
- `apps/web/src/components/threadActionMenu.logic.ts` — Settle and snooze remain header-only menu actions because sidebar rows already expose those controls on hover.
- `apps/web/src/components/threadActionMenu.logic.ts` — The compact “New thread on this branch” label and T3 Pretty's git-branch icon remain unchanged.
- `apps/web/src/components/threadActionMenu.logic.ts` — T3 Pretty's lifecycle and edit icon choices are retained: undo/check for settlement state, alarm-off/clock for snooze state, refresh for title regeneration, and mail for mark-unread.
- `apps/web/src/components/threadActionMenu.logic.ts` — The Copy action remains a dedicated nested group, and Archive remains disabled while a thread is running and visually distinct from destructive Delete.
- `apps/web/src/contextMenuFallback.test.ts` — T3 Pretty's in-app glass context menu continues to support explicit `{ separator: true }` entries rendered as non-interactive ARIA separators.
- `apps/web/src/contextMenuFallback.test.ts` — The fork test fixture's `attrs` attribute view remains functional, preserving existing Pretty context-menu assertions.
- `apps/web/src/contextMenuFallback.ts` — Preserved T3 Pretty's explicit `item.separator` entries, including their standalone rendering and early continuation so they are not treated as actionable menu items.
- `apps/web/src/contextMenuFallback.ts` — Preserved the in-app glass context menu's border-token styling and accessible separator role.
- `apps/web/src/index.css` — Right-panel open/close animation keeps separate gap sizing and fixed-width surface translation, avoiding per-frame reflow of expensive panel contents.
- `apps/web/src/index.css` — Right-panel resize state still disables width transition, and reduced-motion users receive no right-panel transition.
- `apps/web/src/index.css` — Terminal drawer animation keeps separate height allocation and surface translation to avoid resizing the terminal canvas every frame.
- `apps/web/src/index.css` — Terminal resize handling, closed-by-default behavior, open starting style, chat-composer stability, and reduced-motion behavior are retained.
- `apps/web/src/main.tsx` — Desktop installs without an open Clerk gate continue rendering the app unwrapped, avoiding loading the Electron clerk-js bundle until a sign-in surface requires it.
- `apps/web/src/main.tsx` — The Electron provider remains behind React.lazy and a null Suspense fallback, preserving the fork's desktop performance and stable tree/remount behavior.
- `apps/web/src/main.tsx` — T3 Pretty's Clerk appearance configuration and ManagedRelayAuthProvider nesting remain intact.
- `apps/web/src/main.tsx` — The existing browser Clerk provider path and cloud-public-configuration checks remain unchanged.
- `apps/web/src/routes/_chat.index.tsx` — Preserved T3 Pretty's automatic new-session landing behavior by retaining selectDraftLandingProject.
- `apps/web/src/routes/_chat.index.tsx` — Preserved the route's fork-specific styling and collapsed-sidebar titlebar handling by retaining cn and COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS.
- `packages/client-runtime/src/providerSkills.test.ts` — Preserved T3 Pretty's formatProviderSkillInstallSource import and associated fork-specific provider skill presentation behavior.
- `packages/client-runtime/src/providerSkills.test.ts` — Preserved T3 Pretty's normalizeProviderSkillPath helper and Windows path compatibility coverage.
- `packages/client-runtime/src/providerSkills.ts` — Preserved the exported normalizeProviderSkillPath helper and its use when classifying provider skill paths, including Windows path-separator normalization.

## Parent changes integrated at conflict boundaries

- `apps/desktop/src/updates/DesktopUpdates.ts` — The parent's Option-based activeUpdateActionRef is adopted as the unified coordinator for update actions, replacing the old check and download in-flight refs.
- `apps/desktop/src/updates/DesktopUpdates.ts` — Updater errors are classified as install failures using the active UpdateAction rather than only the legacy install boolean.
- `apps/desktop/src/updates/DesktopUpdates.ts` — The parent finishUpdateAction("install") cleanup is incorporated so the unified action reservation is released after recovery.
- `apps/desktop/src/updates/DesktopUpdates.ts` — The parent explicit reset of desktopState.quitting is retained on updater-reported install failure.
- `apps/server/src/orchestration/ActivityPayloadProjection.ts` — Added support for lifecycle identities carried in `payload.toolCallId`, with the parent's intended precedence over legacy or fallback identity sources.
- `apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts` — Added `toolCallId` to `item.completed` activity payloads when `event.itemId` is available, aligning completed events with started and updated tool lifecycle events.
- `apps/server/src/provider/Layers/OpenCodeProvider.test.ts` — kept the fork's deletion of this file over the parent copy
- `apps/server/src/provider/Layers/OpenCodeProvider.ts` — kept the fork's deletion of this file over the parent copy
- `apps/server/src/provider/opencodeRuntime.cliParsers.test.ts` — kept the fork's deletion of this file over the parent copy
- `apps/server/src/provider/opencodeRuntime.ts` — kept the fork's deletion of this file over the parent copy
- `apps/web/src/components/ChatView.tsx` — WorkspacePageHeader now receives the parent's `electron` prop so the shared component owns platform-specific header layout.
- `apps/web/src/components/ChatView.tsx` — Native window-control spacing is delegated through the parent's `reserveNativeControls` prop while retaining the existing condition that avoids double reservation when the inline right panel owns the titlebar.
- `apps/web/src/components/ChatView.tsx` — The parent's relative positioning and background styling are retained.
- `apps/web/src/components/ComposerPromptEditor.tsx` — Adopted formatProviderSkillDisplayName from @t3tools/client-runtime/providerSkills, matching the parent's provider-skill presentation API refactor.
- `apps/web/src/components/chat/ChatComposer.tsx` — Added the parent TurnId contract type import.
- `apps/web/src/components/chat/ChatComposer.tsx` — Moved provider skill display-name formatting to the parent's shared @t3tools/client-runtime/providerSkills implementation.
- `apps/web/src/components/chat/ChatComposer.tsx` — Adopted composerSurfaceRef, data-chat-composer-surface, and mobile collapsed-state metadata.
- `apps/web/src/components/chat/ChatComposer.tsx` — Integrated the parent's command-menu layer rendering, loading state, active-item highlighting, and selection callbacks.
- `apps/web/src/components/chat/ChatComposer.tsx` — Integrated the parent's relocated composer content structure without duplicating review comments, attachments, or the prompt editor.
- `apps/web/src/components/chat/ChatComposer.tsx` — Integrated parent prompt-length validation and the responsive compact footer/model/provider controls layout.
- `apps/web/src/components/chat/ChatComposer.tsx` — Integrated the parent's right-side send/stop action organization.
- `apps/web/src/components/chat/ChatComposer.tsx` — Accepted the parent's relocation of the composer footer and removed the obsolete duplicate toolbar from its former position.
- `apps/web/src/components/chat/ChatComposer.tsx` — Retained the parent's new inline task and stash badges in the relocated right-side action area, including suppression while mobile pending-answer actions are shown.
- `apps/web/src/components/chat/ChatComposer.tsx` — Kept the parent's relocated responsive footer, provider picker, and primary-action structure while composing T3 Pretty controls into it.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Parent source-specific skill icons are integrated for app, repository, project, personal, system, and other skill sources, including screen-reader labels.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Parent skill icons replace the redundant generic skill glyph while the generic glyph remains only for Pretty's provider-command presentation.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Parent row typography is adopted: baseline alignment, medium compact labels, wider spacing, and right-aligned truncated descriptions.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Parent empty-state bottom padding is retained to improve drawer spacing.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Parent command-list scroll padding remains in use with the restored grouped rendering.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — The unused formatProviderSkillInstallSource import is removed as in the parent cleanup.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Adopted workEntryDisplayIndicatesToolFailure, the parent's display-aware tool-failure predicate.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Integrated the parent's collapsed-group failure signal, including the destructive X icon and accessible "Hidden work includes a failure" label.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Used block-compatible working-label markup so the merged JSX remains structurally coherent with the parent refactor.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Added the upstream Search icon name and SVG rendering path alongside Pretty's Package icon.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Integrated upstream's centralized toolGroupAction/toolGroupSummaryIconName mapping, including the new search-oriented icon behavior.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Integrated upstream's shell tokenizer and command-program extraction for live labels, including env/sudo wrappers, wrapper options, quoted arguments, substitutions, Windows drive paths, and recursion limits.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Integrated upstream's liveWorkEntryLabel behavior that reports the active command as “Running &lt;program&gt;” or “Running command”.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Accepted the upstream isExpandedToolGroupEntry prop in PlainWorkEntryRow so parent expanded-group behavior can be used by the surrounding row implementation.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Adopted the upstream workEntryDisplayIndicatesToolFailure API while retaining Pretty's presentation rules.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Upstream expanded-body data coverage is carried through Pretty's structured display pipeline: MCP tool data, resolved/raw commands, detail output, and workspace-relative changed files are still represented.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Expanded tool-group entries now suppress routine leading icons while retaining warning and failure icons, using the upstream isExpandedToolGroupEntry behavior.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Failed tool rows receive upstream's explicit accessible text (`tool call failed`) in the expandable row label.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Visible failure icons receive the upstream image role and accessible label, while suppressed grouped-entry icons are marked aria-hidden.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Upstream's no-success-glyph direction is preserved alongside Pretty's existing exceptional-only status policy.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Added the parent isStackedPullRequestBase helper needed by the new stacked-pull-request detection path.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Added the parent page-only Check out menu with separate-worktree and current-repository destinations, environment selection, and checkout progress handling.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Added the parent auto-merge status badge and primary Resolve conflicts, Ready for review, and Merge actions.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Integrated the parent's cleanup of duplicated approval-count markup while retaining the accessible approval label.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Integrated the parent's timeline newest/oldest toggle behavior, adapted to T3 Pretty's persistence-aware setter.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Imported VcsRef for the parent's isStackedPullRequestBase implementation, preserving its default-ref and remote-ref branch comparison behavior.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Integrated the parent `SidebarUtilityItem` helper, including icon-button labels and top-positioned tooltips.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Integrated the parent `SidebarUtilityMenu` extraction/export, allowing `SidebarChromeFooter` to remain a small composition of provider/update warnings and navigation utilities.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Retained the parent utility-menu behavior for settings, supported pull requests, usage, back navigation, mobile-sidebar closing, and the update pill through the shared function body.
- `apps/web/src/components/threadActionMenu.logic.test.ts` — Branch-related tests use the recursive allIds helper so nested actions such as copy-branch are included.
- `apps/web/src/components/threadActionMenu.logic.test.ts` — The test explicitly verifies that copy-branch is present for branched threads and absent for threads without a branch.
- `apps/web/src/components/threadActionMenu.logic.test.ts` — The absence check for new-thread-on-branch now covers the complete recursive menu tree.
- `apps/web/src/components/threadActionMenu.logic.ts` — Kept the upstream-compatible pin and unpin icons.
- `apps/web/src/components/threadActionMenu.logic.ts` — Added upstream's folder, git-branch, and hash icons to the Path, Branch, and Thread ID copy submenu entries.
- `apps/web/src/components/threadActionMenu.logic.ts` — Preserved upstream's intended separators before edit, copy, and danger sections through T3 Pretty's joinGroups implementation rather than duplicate separatorBefore flags.
- `apps/web/src/components/threadActionMenu.logic.ts` — Integrated upstream's explanatory archive wording clarifying that Archive is non-destructive and sits beside Delete.
- `apps/web/src/components/threadActionMenu.logic.ts` — Retained the upstream archive and delete icons and destructive styling.
- `apps/web/src/contextMenuFallback.test.ts` — Added upstream FakeElement focus and blur behavior, including active-element transitions and focus/blur event dispatch needed by submenu accessibility tests.
- `apps/web/src/contextMenuFallback.test.ts` — Added coverage for upstream `separatorBefore` menu-section behavior, including the separator dataset marker and ARIA role.
- `apps/web/src/contextMenuFallback.test.ts` — Preserved upstream's Map-based fake element attribute storage while synchronizing it with the fork-compatible attribute view.
- `apps/web/src/contextMenuFallback.ts` — Added support for `item.separatorBefore`, rendered only when the menu already contains content.
- `apps/web/src/contextMenuFallback.ts` — Applied upstream's inline separator fallback styling and `data-context-menu-separator` marker to both separator forms for consistent behavior.
- `apps/web/src/index.css` — Added the parent chat-composer shoulder-tab glass styling, dark-mode shadow, and no-backdrop-filter fallback.
- `apps/web/src/index.css` — Added the parent banner-stack-cap attached surface and outline variables, glass treatment, dark-mode values, and compatibility fallback.
- `apps/web/src/index.css` — Added parent drawer and top-drawer attached-surface layout, inset sizing, overlap handling, masked glass pseudo-elements, dark-mode treatment, and fallback rendering.
- `apps/web/src/index.css` — Added parent handling for adjacent drawer seams, top-drawer stacking, and error/info/success/warning attached-surface variants.
- `apps/web/src/main.tsx` — Pinned the Electron provider to Clerk UI build 1.30.5-canary.v20260819050620, the first build containing the upstream PR 9500 fix.
- `apps/web/src/main.tsx` — Adopted the parent first-party fix by using the native Electron passkeys adapter rather than retaining the manual isAutoFillSupported override.
- `apps/web/src/main.tsx` — Integrated the parent Electron Clerk provider and passkey wiring within T3 Pretty's lazy, session-gated architecture instead of eagerly importing and mounting it.
- `packages/client-runtime/src/providerSkills.test.ts` — Integrated the parent resolveProviderSkillSourceKind API and its source-kind tests.
- `packages/client-runtime/src/providerSkills.test.ts` — Adopted the parent's providerSkills.ts source for formatProviderSkillDisplayName as part of the upstream API/refactor.
- `packages/client-runtime/src/providerSkills.ts` — Integrated the narrower ProviderSkillSourceKind return type for resolveProviderSkillSourceKind.

## Parent changes intentionally omitted

- `apps/desktop/src/updates/DesktopUpdates.ts` — Complete removal of the legacy updateInstallInFlightRef as part of consolidating all in-flight state into activeUpdateActionRef.. Reason: The existing T3 Pretty recoverFromInstallFailure routine from the failed-install recovery change still consumes the install-specific ref. Only this one compatibility ref is retained; the parent's activeUpdateActionRef governs action classification and exclusion.
- `apps/server/src/provider/Layers/OpenCodeProvider.test.ts` — The parent's retained OpenCode provider status test suite, including missing-binary handling, health-check errors, model and agent defaults, local CLI behavior, inventory failures, and configured-server error messages.. Reason: T3 Pretty intentionally removed the unused OpenCode provider. Restoring its dedicated test file would resurrect coverage tied to a feature the fork removed.
- `apps/server/src/provider/Layers/OpenCodeProvider.test.ts` — New parent coverage and test fixtures for exposing OpenCode inventory skills in provider snapshots, including filtering skill rows without a location.. Reason: This behavior belongs to the removed OpenCode provider implementation and cannot be integrated coherently in this deleted provider test file without resurrecting the feature.
- `apps/server/src/provider/Layers/OpenCodeProvider.test.ts` — New parent test-double tracking and assertion that the working directory is passed to loadInventoryFromCli.. Reason: This validates the removed OpenCode provider's CLI inventory path; retaining it here would require restoring the deleted provider test infrastructure.
- `apps/server/src/provider/Layers/OpenCodeProvider.ts` — Retain the parent OpenCode provider layer, including its probing, model inventory, authentication status, and runtime integration.. Reason: T3 Pretty deliberately removed this provider as unused; restoring the file would directly undo the fork's authoritative feature removal.
- `apps/server/src/provider/Layers/OpenCodeProvider.ts` — Expose OpenCode inventory skills by trimming and validating skill fields, sorting them, and adding them to the server provider snapshot.. Reason: This enhancement only applies inside the removed OpenCode provider layer, and no replacement implementation is evidenced at this conflict boundary into which it can be integrated.
- `apps/server/src/provider/Layers/OpenCodeProvider.ts` — Pass the current working directory to local OpenCode CLI inventory loading.. Reason: This fix only affects the intentionally removed OpenCode provider status path, so applying it would require resurrecting that path.
- `apps/server/src/provider/opencodeRuntime.cliParsers.test.ts` — Parent's retained model and agent CLI parser test suite for opencodeRuntime.ts.. Reason: T3 Pretty removed the OpenCode provider outright, so retaining tests that import its deleted runtime would resurrect dead provider-specific code or leave broken imports.
- `apps/server/src/provider/opencodeRuntime.cliParsers.test.ts` — Parent's new parseSkillsCliOutput import and tests covering skill metadata parsing and malformed-output fallback.. Reason: These tests target the removed OpenCode runtime/provider. There is no surviving replacement in the supplied context into which this provider-specific coverage can be integrated.
- `apps/server/src/provider/opencodeRuntime.ts` — OpenCode skill inventory support via the SDK and `debug skill` CLI, including schema-based parsing and retry/degradation behavior.. Reason: The fork intentionally removed the entire unused OpenCode provider; resurrecting its runtime solely for new inventory behavior would regress that removal.
- `apps/server/src/provider/opencodeRuntime.ts` — Running OpenCode inventory CLI commands in the requested working directory through the new `cwd` runtime option.. Reason: This applies only to the OpenCode provider runtime that T3 Pretty intentionally removed.
- `apps/web/src/components/chat/ChatComposer.tsx` — Use CompactComposerControlsMenu as the sole compact-mode control implementation, with no thread/auto-PR overflow menu in the relocated footer.. Reason: That hunk would regress T3 Pretty's authoritative consolidated overflow menu and remove access to fork-specific auto-PR, thread, skills, and provider-aware controls. The parent mode and trait behaviors remain represented inside the Pretty overflow menu.
- `apps/web/src/components/chat/ChatComposer.tsx` — Drive ComposerFooterPrimaryActions running state only from phase === "running".. Reason: T3 Pretty intentionally uses turnInProgress so running/thinking feedback remains continuous during thread startup; reverting to phase alone would reintroduce the fork-fixed visual discontinuity.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Flatten all command results into one unlabeled CommandGroup and delete the command-grouping helpers.. Reason: That would regress Pretty's fuller slash, skill, and @ menus, including Files/Skills/Apps and Built-in/Provider sections.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Remove slash-command, runtime-mode, provider-command, and app item glyphs.. Reason: Those icons are part of Pretty's visual menu behavior and app/runtime integrations; they can coexist with the parent's new source-specific skill icons.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Replace the labeled Skills empty state with a single unlabeled paragraph and use the parent path-only “No matching files or folders.” text.. Reason: Pretty's menu searches and presents skills alongside @ results and intentionally keeps a dedicated Skills presentation, so the parent wording would misdescribe fork behavior.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Removal of the neutral-status helper import from the timeline.. Reason: Pretty's work-entry presentation still distinguishes neutral tool statuses; retaining it is compatible with the new display-aware failure predicate.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Larger text-sm/leading-relaxed styling for the turn-fold control.. Reason: It conflicts with Pretty's authoritative compact timeline typography and refined fold-control visual design.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The parent's border-separated, text-sm working-row presentation without Pretty's pulse indicator.. Reason: It would remove Pretty's authoritative working animation and compact activity styling.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The parent's larger text-sm overflow-toggle spacing and typography.. Reason: It conflicts with Pretty's compact work-log disclosure design.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The parent's size-6 icon container, larger chevron, and generic 200ms transition for the overflow toggle.. Reason: The hidden-failure behavior was integrated, but its presentation was adapted to preserve Pretty's compact icon sizing, custom easing, hover feedback, and reduced-motion behavior.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Replace Pretty's structured tool-call display with upstream's flat buildToolCallExpandedBody implementation.. Reason: The fork's structured display is required for command formatting/highlighting, section-aware rendering, changed-file formatting, and multiline disclosure safeguards. The parent's MCP, command, output, and changed-file content remains integrated through that structured pipeline.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Use only the preview as a row label whenever a preview exists.. Reason: This would regress Pretty's deliberate heading-plus-preview presentation and duplicate-label suppression.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Offer disclosure for every non-null expanded body, including a fully visible body that merely repeats the one-line preview.. Reason: Pretty intentionally suppresses redundant disclosure while retaining it for clipping, multiline/whitespace preservation, and structured content.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Render every failed tool with a destructive X and destructive icon color.. Reason: Pretty distinguishes destructive runtime/non-tool failures from ordinary tool-like failures, retaining the tool's semantic icon and muted styling for the latter.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Increase work-entry icon wrappers to size-6.. Reason: This conflicts with T3 Pretty's authoritative compact timeline visual design, which uses size-4 icons.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Remove TimelineRowCtx and TimelineRowActivityCtx consumption from PlainWorkEntryRow.. Reason: Pretty's generated-image rendering binds image paths and state to the generating turn/session through these contexts, so removing them would regress generated-image ownership.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Upstream's whole-row toggle target, row-level hover treatment, conditional py-0/py-0.5 padding, and opacity/translate transition layout.. Reason: Pretty intentionally scopes disclosure interaction and open-state styling to the compact header. Applying the toggle to the outer row would make clicks inside expanded tool and generated-image content collapse the row and would regress the fork's refined row design.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Upstream's tool/non-tool heading colors, text-sm/leading-relaxed typography, and flattened displayText heading.. Reason: These conflict with Pretty's authoritative typography and theming and would remove the separately measured preview span required by the fork's clipped and multiline disclosure fixes.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Upstream's larger size-4, stroke-1.8, opacity-70 work-entry icon styling.. Reason: Pretty's size-3.5, stroke-1.75 icon treatment is part of the fork-specific visual design; upstream's grouped-icon visibility and accessibility behavior were integrated without replacing that presentation.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Upstream's always-reserved chevron slot and removal of explicit failed and active-turn-neutral trailing indicators.. Reason: Pretty deliberately shows only exceptional statuses, keeps its failure and still-open neutral tooltips, omits success glyphs, and uses a custom hover/open/reduced-motion chevron treatment.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Initialize condensed chrome to false with an empty per-tab map on every mount.. Reason: That parent initialization would discard T3 Pretty's saved per-tab chrome state and regress panel view restoration when returning to a pull request or thread.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Derive condensed UI directly from chromeCondensed without chromeVariant gating, while omitting the viewport reference from this block.. Reason: T3 Pretty's panel architecture requires collapse-variant gating and the viewport reference for scroll restoration and no-jump chrome compensation.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Call setTimelineOrder with React's functional-updater form.. Reason: In T3 Pretty, setTimelineOrder is a persistence-aware wrapper that accepts the concrete next order, not a React state-dispatch function. The same upstream toggle behavior is retained using a concrete value.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Use context-specific “Fix findings in this thread” and “Fix findings in a thread” expectations for the bulk findings action.. Reason: T3 Pretty intentionally replaced these labels with the newer visible “Fix all findings” action; restoring the parent-side wording would regress the fork’s bulk-fix UX.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Remove the resolve and resolve-conflicts label expectations from both handoff-label result shapes.. Reason: Those fields protect T3 Pretty’s fork-specific review-thread resolution and conflict handoff behavior, so removing them would regress supported conversation workflows.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Use the parent's context-specific "Fix findings in this thread" and "Fix findings in a thread" labels.. Reason: Those labels would regress T3 Pretty's newer, intentionally visible "Fix all findings" action.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Remove the resolve and resolveConflicts handoff labels from pullRequestHandoffLabels.. Reason: T3 Pretty relies on these fork-specific labels for review-conversation resolution and conflict-resolution handoffs; removing them would regress established fork behavior.
- `apps/web/src/components/sidebar/SidebarChrome.tsx` — Retention of the legacy inline `T3Wordmark` SVG helper.. Reason: It conflicts with T3 Pretty’s authoritative generated sidebar branding and is no longer needed by the branded `SidebarBrand` implementation.
- `apps/web/src/components/threadActionMenu.logic.ts` — Interpolating the branch name in the new-thread label and using the message-square-plus icon.. Reason: This directly conflicts with T3 Pretty's compact branch wording and established git-branch visual treatment.
- `apps/web/src/components/threadActionMenu.logic.ts` — Showing settle and snooze menu entries on every surface, including the sidebar, with circle-check/clock icon choices.. Reason: T3 Pretty intentionally omits these duplicate sidebar menu actions because sidebar rows already provide hover controls; its header-specific state icons are part of the fork's menu design.
- `apps/web/src/components/threadActionMenu.logic.ts` — separatorBefore fields on Rename, Copy, and Archive.. Reason: T3 Pretty's joinGroups function already creates the same section boundaries with explicit separator items; retaining the fields would risk duplicate separators in the glass menu.
- `apps/web/src/components/threadActionMenu.logic.ts` — The refresh-cw icon for title regeneration and mail-open icon for mark-unread.. Reason: These conflict with T3 Pretty's explicit refresh and mail icon choices.
- `apps/web/src/routes/_chat.index.tsx` — Upstream removal of the cn and COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS imports.. Reason: The retained T3 Pretty route presentation still consumes these imports; removing them would break the fork-specific UI and compilation.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.34-nightly.20260822.1155`
- Previously integrated parent nightly: `v0.0.34-nightly.20260819.1133`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/ChatView.tsx` — Preserved the T3 Pretty WorkspacePageHeader abstraction and its existing header styling, native-control inset handling, motion behavior, and inline right-panel titlebar coordination.
- `apps/web/src/components/ChatView.tsx` — Preserved the fork's component structure instead of regressing the closing element to the parent's raw header element.
- `apps/web/src/components/chat/ChatComposer.tsx` — The composer top drawer remains independently gated by showComposerTopDrawer and the tasks-drawer/blocking-drawer rules, including T3 Pretty's expanded and collapsed mobile pending approval/input flows.
- `apps/web/src/components/chat/ChatComposer.tsx` — T3 Pretty's split top-drawer/main-surface composer architecture and polished relative main frame remain intact instead of being replaced by the parent's older enclosing wrapper.
- `apps/web/src/components/chat/ChatComposer.tsx` — Canvas selections, preview annotations, review comments, element contexts, ordinary attachments, removal controls, and image expansion remain arranged in T3 Pretty's richer composer context-card flow.
- `apps/web/src/components/chat/ChatComposer.tsx` — The existing contextual approval placeholder remains capable of showing activePendingApproval.detail, with the generic approval instruction retained as its fallback.
- `apps/web/src/components/chat/ChatComposer.tsx` — The footer keeps T3 Pretty's wrapper, inline tasks/stash badges, compact overflow composition, mobile focus preservation, mobile send-while-running behavior, and plan/submission actions.
- `apps/web/src/components/chat/ComposerBannerStack.tsx` — T3 Pretty’s `chat-composer-banner-stack-cap` visual treatment, including its fork-specific background/theming behavior.
- `apps/web/src/components/chat/ComposerBannerStack.tsx` — T3 Pretty’s `rounded-t-2xl` stack-cap geometry.
- `apps/web/src/index.css` — Preserved T3 Pretty's attachment-aware split glass surfaces for composer drawers, shoulder tabs, and explicitly attached states, including backdrop-filter fallbacks and shadow behavior.
- `apps/web/src/index.css` — Preserved the mobile-collapsed attachment overlap minimum height.
- `apps/web/src/index.css` — Preserved context-strip seam clipping for both the normal host outline and the split main-surface outline.
- `apps/web/src/index.css` — Preserved T3 Pretty's light and dark specular top-edge treatment on the active composer outline.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/ChatView.tsx` — Integrated the Electron-only TitlebarLayoutControlsDragHole for the parked two-control cluster when the inline right panel does not own the titlebar.
- `apps/web/src/components/ChatView.tsx` — Integrated the parent's condition and explanatory placement logic so parked titlebar controls remain interactive while the right panel is closed.
- `apps/web/src/components/chat/ChatComposer.tsx` — Added the parent's compositor-driven ultrathink rainbow ring to T3 Pretty's current main composer frame.
- `apps/web/src/components/chat/ChatComposer.tsx` — Added visible, accessible spinner tiles for images currently being compressed, including when no completed image attachment exists yet.
- `apps/web/src/components/chat/ChatComposer.tsx` — Forwarded isInterrupting to the active ComposerFooterPrimaryActions instance so the parent interruption-state behavior works with T3 Pretty's footer architecture.
- `apps/web/src/components/chat/ComposerBannerStack.tsx` — Removed the cap’s default `pointer-events-none`, allowing the button to receive pointer focus and activate the existing `group-focus-within` expansion behavior for improved accessibility.
- `apps/web/src/index.css` — Integrated the upstream focus-within rim color and border-color transition, adapting it to the fork's split main-surface outline when the normal host outline is hidden.
- `apps/web/src/index.css` — Integrated upstream reduced-motion handling for rim transitions on both normal and split composer surfaces.
- `apps/web/src/index.css` — Integrated the compositor-only pointer-reactive specular highlight for fine hover pointers, including context-strip sizing and dark-mode styling.
- `apps/web/src/index.css` — Integrated reduced-motion and World Scenery Motion-toggle gates that disable the pointer specular and its associated work.

## Parent changes intentionally omitted

- `apps/web/src/components/chat/ChatComposer.tsx` — Replace the approval-state prompt placeholder with the always-generic text “Resolve this approval request to continue”.. Reason: T3 Pretty retains the more informative activePendingApproval.detail when available and already uses that exact generic text as the fallback. Removing the detail would regress the fork's contextual approval UX.
- `.github/workflows/ci.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.34-nightly.20260822.1155`
- Previously integrated parent nightly: `v0.0.34-nightly.20260819.1133`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/desktop/src/ipc/methods/window.ts` — `apps/desktop/src/ipc/methods/window.ts` — Editor launching keeps resolving through the fork's resolveEditorExecutable; the now-unused isCommandAvailable import stays removed.
- `apps/desktop/src/preload.ts` — `apps/desktop/src/preload.ts` — The fork's guarded getPathForFile bridge (empty string on failure) remains exposed.
- `apps/server/src/assets/AssetAccess.ts` — `apps/server/src/assets/AssetAccess.ts` — T3 Pretty's managed project favicon flow (ProjectFaviconStore lookup, managed absolutePath claims, managedProjectFaviconFileName token naming) remains the authoritative path for managed favicons.
- `apps/server/src/assets/AssetAccess.ts` — `apps/server/src/assets/AssetAccess.ts` — Canonical favicon resolution keeps the fork's AssetProjectFaviconInspectionError classification.
- `apps/web/src/components/ChatView.tsx` — `apps/web/src/components/ChatView.tsx` — The fork's hasOptimisticWorkingSettled-based hold on the optimistic dispatch stays authoritative, preserving continuous working feedback while a new thread starts.
- `apps/web/src/components/ChatView.tsx` — `apps/web/src/components/ChatView.tsx` — isSendBusy keeps requiring !sendAcknowledged and isOptimisticWorking remains derived from the held dispatch.
- `apps/web/src/components/ChatView.tsx` — `apps/web/src/components/ChatView.tsx` — The scenery hero/dock placement write, motion gate, and draft-dock derivation remain wired to isDraftHeroState.
- `apps/web/src/components/chat/ChatHeader.tsx` — `apps/web/src/components/chat/ChatHeader.tsx` — The thread-title menu keeps opening with the fork's motion: "dropdown" presentation hint.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — `apps/web/src/components/chat/ComposerCommandMenu.tsx` — The fork's grouped command sections with labels keep rendering instead of the parent's flat list.
- `apps/web/src/components/settings/ProjectFaviconPickerDialog.tsx` — `apps/web/src/components/settings/ProjectFaviconPickerDialog.tsx` — The fork's hidden file-input browse path remains available where no native picker exists, so web favicon picking keeps working.
- `apps/web/src/composer-logic.ts` — `apps/web/src/composer-logic.ts` — The fork's extended ComposerSlashCommand union (skills, new-thread, settings, commands, auto-pr) and its doc comment remain authoritative.
- `apps/web/src/index.css` — `apps/web/src/index.css` — The ultrathink ring/chroma animations stay frozen when T3 Pretty scenery motion is off or the OS requests reduced motion.
- `docs/user/composer.md` — `docs/user/composer.md` — T3 Pretty's Slash commands table keeps documenting the fork-only `/auto-pr` toggle and `$skill` mention flow.
- `docs/user/composer.md` — `docs/user/composer.md` — The Linking files and skills section keeps the fork's Files/Skills split menu behavior.

## Parent changes integrated at conflict boundaries

- `apps/desktop/src/ipc/methods/window.ts` — `apps/desktop/src/ipc/methods/window.ts` — Integrated the parent's WORKSPACE_IMAGE_PREVIEW_EXTENSIONS import for the workspace image-preview dialog filters.
- `apps/desktop/src/preload.ts` — `apps/desktop/src/preload.ts` — Integrated the parent's pickProjectFavicon IPC bridge for the native favicon picker.
- `apps/server/src/assets/AssetAccess.ts` — `apps/server/src/assets/AssetAccess.ts` — Integrated the parent's external favicon override: absolute projectFaviconPath detection, project-favicon-external claims, and resolveCanonicalFile handling alongside the fork's managed flow.
- `apps/web/src/components/ChatView.tsx` — `apps/web/src/components/ChatView.tsx` — Integrated the parent's ComposerSubmissionIntent tracking on the optimistic dispatch and the backgroundSubmissionPending surface, adapted to the fork's holdActive lifecycle.
- `apps/web/src/components/ChatView.tsx` — `apps/web/src/components/ChatView.tsx` — Adopted the parent's resolveDraftHeroState helper (background submissions hold the hero state) while keeping the fork's scenery placement side effects.
- `apps/web/src/components/chat/ChatHeader.tsx` — `apps/web/src/components/chat/ChatHeader.tsx` — Integrated the parent's pending-then-open title menu (double-click guard, chevron shortcut, TITLE_MENU_OPEN_DELAY_MS) and double-click rename handling.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — `apps/web/src/components/chat/ComposerCommandMenu.tsx` — The parent's triggerKind prop now flows to ComposerCommandMenuItem inside the fork's grouped rendering.
- `apps/web/src/components/settings/ProjectFaviconPickerDialog.tsx` — `apps/web/src/components/settings/ProjectFaviconPickerDialog.tsx` — Adopted the parent's first-party native Open-in-file-manager action (pickExternal, CommandFooterAction, toast errors) as the preferred desktop path; the fork file-input button is the fallback when pickExternal is unavailable.
- `apps/web/src/composer-logic.ts` — `apps/web/src/composer-logic.ts` — Integrated the parent's ComposerSubmissionIntent foreground/background type alongside the fork union.
- `apps/web/src/index.css` — `apps/web/src/index.css` — Integrated the parent's preview-loading-progress keyframes and reduced-motion handling.
- `docs/user/composer.md` — `docs/user/composer.md` — Integrated the parent's Cmd+Enter background-thread start paragraph after the composer intro.

## Parent changes intentionally omitted

- `.github/workflows/ci.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.34-nightly.20260822.1162`
- Previously integrated parent nightly: `v0.0.34-nightly.20260822.1155`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/modules/t3-markdown-text/src/SelectableMarkdownText.ios.tsx` — Long-press handling for chat links remains available through `onLinkLongPress`, including direct handling by native selectable text and context propagation for links rendered inside rich markdown blocks.
- `apps/mobile/modules/t3-markdown-text/src/SelectableMarkdownText.ios.tsx` — The fork's `highlightCodeEnabled` control remains forwarded to `NativeMarkdownBlock`.
- `apps/mobile/modules/t3-markdown-text/src/SelectableMarkdownText.ios.tsx` — The mobile shrink-to-fit text reflow safeguard (`flexShrink: 1` and `minWidth: 0`) and existing native markdown chunk spacing remain intact.
- `apps/mobile/modules/t3-markdown-text/src/SelectableMarkdownText.types.ts` — Preserved the optional onLinkLongPress callback used by T3 Pretty mobile to expose copy and open actions when long-pressing chat links.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Preserved useOutgoingMessagePreviewUris, which keeps local outgoing image previews visible for newly sent mobile messages.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Preserved renderItem dependency tracking for threadId, workspaceRoot, and focus state so rows refresh with the correct thread/workspace context and active-screen behavior.
- `apps/server/src/persistence/Migrations.ts` — The established T3 Pretty migration IDs 41–49 remain unchanged, avoiding corruption or reinterpretation of migration history on existing fork databases.
- `apps/server/src/persistence/Migrations.ts` — Migration 41 continues to add orchestration-event recorded-at persistence.
- `apps/server/src/persistence/Migrations.ts` — Migration 42 continues to preserve projection thread branch heads and associated PR branch identity behavior.
- `apps/server/src/persistence/Migrations.ts` — Migration 43 continues to persist World Scenery thread assignments.
- `apps/server/src/persistence/Migrations.ts` — Migration 44 continues to provide the fork's thread canvas schema.
- `apps/server/src/persistence/Migrations.ts` — Migration 45 continues to provide thread-activity compaction metadata.
- `apps/server/src/persistence/Migrations.ts` — Migration 46 continues to persist enabled skill IDs for the skills registry and per-thread materialization behavior.
- `apps/server/src/persistence/Migrations.ts` — Migration 47 continues to clean up superseded tool-updated activities.
- `apps/server/src/persistence/Migrations.ts` — Migration 48 continues to persist T3 Pretty's global and per-thread subagent policy.
- `apps/server/src/persistence/Migrations.ts` — Migration 49 continues to provide the fork's ranked search index.
- `apps/server/src/server.test.ts` — Preserved the T3 Pretty StorageInventoryService test dependency used by the fork's storage-management behavior.
- `apps/server/src/ws.ts` — The ShellStream broadcaster dependency used by T3 Pretty's shell synchronization and resume behavior remains available.
- `apps/server/src/ws.ts` — Bootstrap turn starts safely adopt an already-existing compatible thread, reject cross-project collisions, recover from concurrent duplicate-creation races, and reuse an existing prepared worktree when appropriate.
- `apps/server/src/ws.ts` — Bootstrap thread creation continues to carry T3 Pretty's enabled-skill IDs and optional global/per-thread subagent policy.
- `apps/server/src/ws.ts` — Managed project favicons continue to be released after successful favicon replacement or project deletion, preventing leaked fork-managed icon files.
- `apps/web/src/components/ChatMarkdown.tsx` — T3 Pretty's single-pass extraction of markdown href and inline-code file candidates, including fenced-code, link-label, and markdown-looking inline-code edge cases.
- `apps/web/src/components/ChatMarkdown.tsx` — T3 Pretty's ref-backed file-link metadata cache remains the first lookup, preserving its render hot-path optimization.
- `apps/web/src/components/ChatMarkdown.tsx` — The fork's requirement that generated or workspace images remain pinned to the originating conversation is satisfied by the parent replacement's environment- and thread-scoped signed asset request.
- `packages/ssh/src/tunnel.ts` — Windows SSH remote launch continues to invoke Node directly with the remote state key instead of attempting to run a POSIX shell.
- `packages/ssh/src/tunnel.ts` — Remote launch script generation remains platform-specific: Windows uses buildRemoteWindowsLaunchScript, while POSIX uses buildRemoteLaunchScript.

## Parent changes integrated at conflict boundaries

- `apps/mobile/modules/t3-markdown-text/src/SelectableMarkdownText.ios.tsx` — Integrated upstream custom markdown image rendering by accepting `renderImage` and providing it through `MarkdownImageRendererContext` around the rendered markdown tree.
- `apps/mobile/modules/t3-markdown-text/src/SelectableMarkdownText.types.ts` — Integrated the optional renderImage prop and its MarkdownImageRenderer type contract for app-supplied rendering of markdown images, including workspace-relative image resolution.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Integrated the parent useAssetUrlState API alongside the existing useAssetUrl import.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Added renderMarkdownImage to the renderItem callback dependency list, preventing stale markdown image rendering behavior.
- `apps/server/src/persistence/Migrations.ts` — The parent AuthSessionClientConnection migration is imported and registered in the fork as migration 50, so its first-party auth-session connection persistence behavior is applied after T3 Pretty's already-published migrations.
- `apps/server/src/server.test.ts` — Integrated the parent AnalyticsService test dependency for the new telemetry/analytics implementation.
- `apps/server/src/ws.ts` — WebSocket orchestration dispatches now carry the connecting client's surface and app-version origin metadata when available.
- `apps/server/src/ws.ts` — Upstream analytics records client thread-start and turn-request events, including bootstrap turn starts that create a thread.
- `apps/server/src/ws.ts` — Bootstrap-created threads and ordinary normalized commands are routed through the upstream dispatchFromClient wrapper while retaining T3 Pretty's surrounding safeguards.
- `apps/web/src/components/ChatMarkdown.tsx` — Uncached markdown file links now fall back to resolveMarkdownFileLinkMeta, so valid links missed by the precomputed candidate cache still render as file chips.
- `apps/web/src/components/ChatMarkdown.tsx` — The parent's first-party markdown image renderer replaces the fork-only renderer, including normalized source classification, constrained lazy loading for direct images, signed thread-scoped workspace assets, loading placeholders, and unavailable-image fallbacks.
- `apps/web/src/components/ChatMarkdown.tsx` — The obsolete base extractMarkdownLinkHrefs helper remains removed; Pretty's newer combined candidate extractor serves the fork's cache instead.
- `packages/ssh/src/tunnel.ts` — POSIX remote launches now invoke `sh` with `-l`, enabling login-shell environment initialization before executing the streamed launch script.

## Parent changes intentionally omitted

- `apps/server/src/persistence/Migrations.ts` — The parent's numeric assignment of AuthSessionClientConnection as migration 41.. Reason: Migration ID 41 is already published by T3 Pretty as OrchestrationEventRecordedAt, and IDs 42–49 are also occupied. Reusing or renumbering those IDs would regress existing fork databases, so the complete parent migration is retained under the next available ID, 50.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.34-nightly.20260823.1164`
- Previously integrated parent nightly: `v0.0.34-nightly.20260822.1162`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/features/threads/ThreadFeed.tsx` — T3 Pretty's mobile user-message image source resolution and associated typed image handling remain available, protecting sent-image display behavior.
- `apps/web/src/contextMenuFallback.ts` — Preserved the T3 Pretty in-app glass context-menu implementation's guard against inserting adjacent duplicate separators.
- `apps/web/src/contextMenuFallback.ts` — Preserved separator accessibility semantics and existing glass-menu styling structure.
- `apps/web/src/index.css` — Dialog glass continues to use the fork's purpose-specific --glass-blur-overlay value rather than collapsing back to the generic glass blur.
- `apps/web/src/index.css` — Dropdown glass continues to use the fork's purpose-specific --glass-blur-raised value.
- `apps/web/src/index.css` — T3 Pretty's dropdown rim lighting, dark-mode glass treatment, and Tailwind shadow-composition behavior remain intact.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Integrated the parent mobile markdown image maximum-width and display-size utilities.
- `apps/web/src/contextMenuFallback.ts` — Integrated the parent's use of `var(--contrast-border)` for `separatorBefore` inline styling, improving separator contrast under themed context menus.
- `apps/web/src/index.css` — Dialog and dropdown borders now use the parent's --contrast-foreground semantic token, improving border contrast across themes.

## Parent changes intentionally omitted

- `apps/web/src/index.css` — Use the generic --glass-blur value for dialog glass.. Reason: This would regress T3 Pretty's intentional overlay-specific blur hierarchy; the compatible upstream border-token change is integrated separately.
- `apps/web/src/index.css` — Use the generic --glass-blur value for dropdown glass.. Reason: This would regress T3 Pretty's intentional raised-surface blur hierarchy; the compatible upstream border-token change is integrated separately.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.34-nightly.20260823.1167`
- Previously integrated parent nightly: `v0.0.34-nightly.20260823.1166`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Preserved the mobile draft-image picker flow, including pending preview preparation through beginPendingPreviews and cleanup in the surrounding finally block.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Preserved the fork's dedicated send lifecycle, queue/steer delivery handling, in-flight tracking, and T3 Pretty Live Activity branding in handleSend.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Avoided accidentally sending a message when the user invokes the image picker.
- `apps/mobile/src/lib/threadActivity.test.ts` — Incremental mobile feed derivation continues to reuse unchanged activity groups during streaming updates.
- `apps/mobile/src/lib/threadActivity.test.ts` — Stable row identity coverage remains for unchanged messages and activities while replacing only the changed streaming message row.
- `apps/mobile/src/lib/threadActivity.test.ts` — Out-of-order replay updates retain stateless sorting semantics and unaffected row identities.
- `apps/mobile/src/lib/threadActivity.test.ts` — Equal-timestamp reordering retains stable-sort fallback coverage.
- `apps/mobile/src/lib/threadActivity.test.ts` — Loaded-message window boundary changes remain verified against stateless feed derivation.
- `apps/mobile/src/lib/threadActivity.test.ts` — Activity groups remain verified to split correctly when an initially empty streaming message becomes visible.
- `apps/mobile/src/lib/threadActivity.ts` — T3 Pretty's centralized assembleThreadFeed pipeline remains authoritative instead of restoring the older duplicated sorting and work-log mapping implementation.
- `apps/mobile/src/lib/threadActivity.ts` — T3 Pretty's buildActivityFeedEntries derivation remains in use, preserving fork activity filtering, Thinking-row behavior, generated headlines, tool handling, and other mobile work-log behavior encoded by that helper.
- `apps/mobile/src/lib/threadActivity.ts` — The activity cutoff continues to use the oldest actually loaded message, preserving paginated-feed behavior.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Queued-message dispatch and retry state remain available for mobile send-progress and active-work calculations.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Optimistic starting-thread messages, queued messages, and server messages continue to be merged into the feed, with optimistic state cleared when the server message arrives.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Pretty's reusable thread-feed builder and feed-build performance spans remain in place for long-session mobile performance.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Messages continue to support standard queue/steer delivery through TurnDeliveryMode when sent during an active turn.
- `apps/mobile/src/state/use-thread-composer-state.ts` — The effective draft model selection is used for sending, and runtime mode is remapped only with the known selected provider driver, preserving stored provider-specific modes when the driver is unknown.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Composer content is cleared synchronously after enqueue and fully restored on durable-write failure without dropping attachments added while the write is pending.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Queue failures continue to use Pretty's immediate native Alert presentation rather than regressing its mobile error UX.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Active-work timing continues to account for optimistic sends, queued-head creation, queue dispatch, and the selected environment's connection state.
- `apps/server/src/server.test.ts` — Retained ProviderSessionDirectory integration and its test-layer override, preserving T3 Pretty's session-scoped provider behavior and associated test coverage.
- `apps/server/src/ws.ts` — Preserved `ProjectImportFaviconError`, retaining T3 Pretty's managed project-favicon import and error-handling path.
- `apps/server/src/ws.ts` — Preserved `ProviderSessionDirectory` and its layer acquisition, retaining T3 Pretty's provider-session association used by session-pinned provider assets such as Grok-generated images.
- `apps/web/src/components/ChatView.tsx` — T3 Pretty's painted appearance hook remains authoritative instead of reverting to the parent's generic theme hook, preserving fork-specific visual and theming behavior.
- `apps/web/src/components/ChatView.tsx` — The composer continues receiving isInterrupting and isOptimisticWorking state, preserving T3 Pretty's running-agent queue/steer controls and optimistic working UX.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Retained the parent behavior that checks onSendMessage's returned message ID and does not arm agent-awareness Live Activity when sending returns null; this is already present in the adjacent handleSend callback.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Retained post-send agent-awareness Live Activity arming for successful sends, composed into the fork's canonical send path rather than duplicated in the image-picker path.
- `apps/mobile/src/lib/threadActivity.test.ts` — Added the parent regression test ensuring older local feedback command and assistant rows remain before a newer server-returned message.
- `apps/mobile/src/lib/threadActivity.ts` — Optional localMessages are appended to loaded messages and included in message feed derivation, matching the parent mobile behavior.
- `apps/mobile/src/lib/threadActivity.ts` — The pagination/activity cutoff remains based on loadedMessages rather than appended local messages, matching the parent implementation.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Added first-party Codex feedback command recognition and upload through threadEnvironment.uploadFeedback.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Added per-thread feedback submission tracking, including local user and assistant feed messages and suppression of interrupted submissions.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Added interrupted-command handling, Cause-based failure extraction, success/failure alerts, and haptic copying of the returned OpenAI feedback thread ID.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Integrated feedback messages into Pretty's existing optimized feed build rather than replacing its optimistic and queued-message pipeline.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Adopted the selectedEnvironmentRuntime supplied by useThreadSelection, avoiding a redundant remote-environment runtime subscription.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Applied feedback provider detection to the effective outbound model selection while retaining upstream's active-session Codex fallback.
- `apps/server/src/server.test.ts` — Integrated the parent ProviderService import and configurable test-layer override.
- `apps/server/src/server.test.ts` — Integrated ProviderAdapterRequestError for the parent's provider adapter error-path tests.
- `apps/server/src/ws.ts` — Integrated `ProviderUploadFeedbackError` for the parent's provider-upload feedback RPC behavior.
- `apps/server/src/ws.ts` — Integrated the parent's `ProviderService` import and service acquisition without displacing T3 Pretty's provider-session directory.
- `apps/web/src/components/ChatView.tsx` — Imported the parent's shared writeTextToClipboard helper for the surrounding feedback functionality.
- `apps/web/src/components/ChatView.tsx` — Integrated the parent's feedback-upload guard so the composer reports "Sending feedback" and prevents conflicting sends while feedback is uploading, while retaining the existing message-loading guard.

## Parent changes intentionally omitted

- `apps/mobile/src/state/use-thread-composer-state.ts` — Report queued-message persistence failures through setPendingConnectionError.. Reason: That presentation conflicts with T3 Pretty's authoritative native mobile Alert behavior and would produce competing error surfaces; draft and attachment restoration is still preserved in full.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Determine the feedback provider solely from thread.modelSelection.. Reason: T3 Pretty supports draft-level model/provider selection, so using the persisted thread model can intercept a feedback-looking command for the wrong outbound provider. The resolution uses the effective send model and retains upstream's session.providerName fallback.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.34-nightly.20260823.1169`
- Previously integrated parent nightly: `v0.0.34-nightly.20260823.1166`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Preserved T3 Pretty's thread rename action in the slim-row context menu.
- `apps/mobile/src/features/threads/threadListV2.test.ts` — Pinned threads remain in the pinned card block when a stale settled override is still present; they land on the settled shelf only after persistence unpins them.
- `apps/mobile/src/features/threads/threadListV2.test.ts` — Pull-request merges do not automatically settle or unpin T3 Pretty threads, including pinned threads.
- `apps/mobile/src/features/threads/threadListV2.test.ts` — Inactivity does not silently demote a pinned thread to the settled shelf.
- `apps/mobile/src/features/threads/threadListV2.test.ts` — Pinned settle transitions retain the fork's card/slim partition and landing behavior, preventing premature shelf departures.
- `apps/web/src/components/ChatView.tsx` — Preserved the `liveHeadline={liveTurnHeadline}` timeline input that powers T3 Pretty's generated live activity headlines.
- `apps/web/src/components/Sidebar.tsx` — T3 Pretty’s single-shelf classification remains intact, allowing dock attention to be calculated across all projects before applying the visible project scope.
- `apps/web/src/components/Sidebar.tsx` — Snoozed threads remain excluded from the inbox/dock count and are placed on the snoozed shelf only once.
- `apps/web/src/components/Sidebar.tsx` — A snoozed pin retains its pin and pinOrderKey so it returns to its exact pinned position after waking.
- `apps/web/src/components/Sidebar.tsx` — Outside the snooze interval, pinning continues to override settlement, preventing stale or raced settlement state from hiding a pinned thread.
- `scripts/build-desktop-artifact.ts` — Preserved the exported resolveCargoTargetDir helper, including support for trimmed CARGO_TARGET_DIR values, repo-relative resolution, and the in-tree resource-monitor target fallback.
- `scripts/build-desktop-artifact.ts` — Preserved T3 Pretty's release-build compatibility with custom or cached Cargo target directories.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Integrated the parent behavior that exposes pin lifecycle and pin-reordering actions for pinned slim rows.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Integrated the parent memo dependencies on pinMenuItem and thread.pinnedAt so slim-row actions update correctly when pin state or ordering capabilities change.
- `apps/mobile/src/features/threads/threadListV2.test.ts` — Added upstream's pinned merged-thread regression scenario, including verification that the stored pinnedAt value remains intact, adapted to T3 Pretty's no-auto-settle policy.
- `apps/mobile/src/features/threads/threadListV2.test.ts` — Added upstream's inactive pinned-thread fixture as regression coverage, adapted to assert the fork's pin-first partitioning.
- `apps/mobile/src/features/threads/threadListV2.test.ts` — Integrated upstream's explicit autoSettleOnMerge: false API coverage and its pinned-card expectations.
- `apps/web/src/components/ChatView.tsx` — Adopted `activeRunningTurnId` for `MessagesTimeline` instead of deriving the running turn ID directly from `activeThread.session`, preserving the parent's refactor and any centralized running-turn semantics.
- `apps/web/src/components/Sidebar.tsx` — Integrated the parent clarification that snooze outranks both settlement and pinning until the thread wakes.
- `apps/web/src/components/Sidebar.tsx` — Adapted the parent snoozed-row handling to assign the fork’s `snoozed` shelf rather than directly mutating the scoped list, preserving the parent-visible behavior within Pretty’s partition architecture.
- `scripts/build-desktop-artifact.ts` — Exported stageResourceMonitor as introduced by the parent nightly, while retaining the fork's target-directory helper used by its implementation.

## Parent changes intentionally omitted

- `apps/mobile/src/features/threads/threadListV2.test.ts` — Treat a thread with both pinnedAt and settled state as unpinned and place it on the settled shelf immediately.. Reason: This conflicts with T3 Pretty's pinned-settle landing contract: the pin wins until persistence clears pinnedAt, avoiding a premature shelf transition.
- `apps/mobile/src/features/threads/threadListV2.test.ts` — Automatically move a pinned thread to the settled shelf when its pull request merges under the default list policy.. Reason: T3 Pretty explicitly stopped auto-settling threads on pull-request merge; retaining the pin and active card is authoritative fork behavior.
- `apps/mobile/src/features/threads/threadListV2.test.ts` — Automatically move an inactive pinned thread to the settled shelf while its persisted pinnedAt remains set.. Reason: T3 Pretty gives persisted pins precedence and requires an actual unpin before a pinned thread departs for the settled shelf.
- `apps/mobile/src/features/threads/threadListV2.ts` — Check settlement before persisted pin state when partitioning mobile rows.. Reason: This would contradict the preserved pin-first tests and T3 Pretty's web behavior; a pin remains visible until persistence clears `pinnedAt`.
- `apps/web/src/components/Sidebar.tsx` — THEIRS removes the pre-settlement pinned-thread branch, which would make settlement take precedence when a thread is simultaneously pinned and settled.. Reason: That precedence conflicts with T3 Pretty’s documented lifecycle safeguard: pins must remain visible and must not auto-settle out of sight. Simultaneous state is expected only from stale or raced writes, so retaining pin-before-settlement prevents a fork behavior regression while omitting only the incompatible precedence change.
- `.github/workflows/release.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.34-nightly.20260824.1173`
- Previously integrated parent nightly: `v0.0.34-nightly.20260823.1170`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/chat/ChatComposer.tsx` — Preserved the `skillMentionToken` integration used by T3 Pretty's provider-skill mention behavior.
- `apps/web/src/components/chat/ChatComposer.tsx` — Preserved provider-specific runtime-mode entries in the slash menu.
- `apps/web/src/components/chat/ChatComposer.tsx` — Preserved T3 Pretty's `/skills`, conditional `/auto-pr`, `/new`, `/commands`, and `/settings` composer commands, including the state-aware auto-PR description.
- `apps/web/src/components/chat/ChatComposer.tsx` — Preserved dependency tracking for conditional auto-PR command visibility.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — T3 Pretty's Bot icon for built-in slash commands, runtime-mode icons, provider-command SkillGlyph, and branded AppIcon rendering remain intact.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — T3 Pretty's grouped slash, skill, file, and app menu presentation remains supported through CommandGroupLabel.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — T3 Pretty's command-row baseline alignment and wider gap rhythm are preserved rather than replaced by the parent's tighter row styling.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Fork-added app mention presentation continues to use each app's name, color, and icon domain.
- `apps/web/src/components/usage/UsagePage.tsx` — Preserved T3 Pretty’s expanded provider support, including Cursor, Grok, and Kimi, because the span remains provider-agnostic and derives from activeProviders.
- `apps/web/src/components/usage/UsagePage.tsx` — Preserved the existing T3 Pretty usage-page styling and empty-state presentation.
- `apps/web/src/routes/_chat.pull-requests.tsx` — Preserved the `data-pull-requests-header` attribute used by T3 Pretty's pull-request visual design and World Scenery styling hooks.
- `apps/web/src/routes/_chat.pull-requests.tsx` — Kept the existing conditional native-control reservation based on the Pretty right-panel layout.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/chat/ChatComposer.tsx` — Imported and used the parent's `getProviderSkillsForSlashMenu` helper so provider skills in the slash menu respect `settings.showSkillsInSlashMenu`.
- `apps/web/src/components/chat/ChatComposer.tsx` — Integrated the parent's `getProviderSlashCommandsForSlashMenu` path, replacing direct provider command enumeration while retaining the existing menu-item presentation.
- `apps/web/src/components/chat/ChatComposer.tsx` — Added `settings.showSkillsInSlashMenu` to the composer menu memo dependencies so setting changes update the menu immediately.
- `apps/web/src/components/chat/ChatComposer.tsx` — Retained the parent's slash-menu skill items and provider command/skill composition around T3 Pretty's additional built-in commands.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Integrated the parent's Badge import required by skill-source badges.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Integrated the parent's isSlashSkill naming, matching the declaration and avoiding the stale slashSkill reference.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Integrated the parent's bounded, truncating command-label layout so long skill and command names do not crowd descriptions or source badges.
- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — Accepted the parent's removal of the obsolete FolderGit2Icon import, consistent with the current FolderIcon source-kind mapping.
- `apps/web/src/components/usage/UsagePage.tsx` — Integrated the parent fix that calculates the empty-state colSpan from activeProviders, keeping it synchronized with the dynamically rendered provider columns.
- `apps/web/src/routes/_chat.pull-requests.tsx` — Render `titlebarControls` as a descendant of `WorkspacePageHeader`, allowing its no-drag interactive region to receive clicks inside Electron's draggable header.
- `apps/web/src/routes/_chat.pull-requests.tsx` — Apply the upstream relative positioning and background classes needed for the controls strip's header-local positioning.
- `apps/web/src/routes/_chat.pull-requests.tsx` — Integrated the updated explanation of how the controls move between the column header and route-level anchor when the right panel opens.

## Parent changes intentionally omitted

- `apps/web/src/components/chat/ComposerCommandMenu.tsx` — The parent changed the command-row content container from baseline alignment with gap-3 to centered alignment with gap-2.. Reason: That styling conflicts with T3 Pretty's established command-menu visual spacing. The functional overflow and skill-badge improvements were integrated independently, so only the smallest conflicting presentation change was omitted.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.35-nightly.20260826.1194`
- Previously integrated parent nightly: `v0.0.35-nightly.20260826.1193`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/main.tsx` — Electron Clerk and passkey modules remain dynamically imported, so desktop installations without an opened cloud sign-in gate do not load the Clerk bundle.
- `apps/web/src/main.tsx` — The persistent Clerk gate behavior remains authoritative, including mounting the provider only after the gate opens and using a null Suspense fallback to preserve the intended tree/remount behavior.
- `apps/web/src/main.tsx` — ManagedRelayAuthProvider remains inside the Electron Clerk provider when cloud authentication is active.
- `apps/web/src/main.tsx` — T3 Pretty's shared Clerk appearance and presentation remain applied to both Electron and hosted-web authentication.

## Parent changes integrated at conflict boundaries

- `apps/web/src/main.tsx` — Removed the obsolete pinned `__internal_clerkUIVersion` canary override from the Electron Clerk provider, matching the parent nightly's provider configuration while retaining the fork's lazy-loading architecture.

## Parent changes intentionally omitted

- None. The resolver did not omit any parent change to protect T3 Pretty.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.35-nightly.20260826.1195`
- Previously integrated parent nightly: `v0.0.35-nightly.20260826.1194`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/server/src/persistence/Migrations.ts` — The established T3 Pretty migration history and IDs 41–51 remain unchanged, preventing already-applied databases from interpreting different migrations under existing IDs.
- `apps/server/src/persistence/Migrations.ts` — Orchestration event recorded-at data and projection thread branch-head support remain registered.
- `apps/server/src/persistence/Migrations.ts` — World Scenery thread assignments and the fork's thread canvas schema remain registered.
- `apps/server/src/persistence/Migrations.ts` — Thread activity compaction metadata and superseded tool-update cleanup remain registered.
- `apps/server/src/persistence/Migrations.ts` — Enabled skills and global/per-thread subagent policy persistence remain registered.
- `apps/server/src/persistence/Migrations.ts` — The fork's BM25-backed thread search index remains registered.
- `apps/server/src/persistence/Migrations.ts` — Auth session client connection and linked pull-request migrations retain their established collision-free T3 Pretty registrations at IDs 50 and 51.
- `apps/web/src/lib/threadSort.ts` — Preserved T3 Pretty's `compareIsoDateTimes` export used by its cross-surface thread sorting reliability behavior.

## Parent changes integrated at conflict boundaries

- `apps/server/src/persistence/Migrations.ts` — The parent ProjectionThreadsUnsettledAt migration is fully incorporated using its upstream migration module and appended as migration ID 52 to coexist with T3 Pretty's established schema history.
- `apps/server/src/persistence/Migrations.ts` — The parent auth-session client connection and linked pull-request migrations remain included at the fork's previously assigned IDs 50 and 51.
- `apps/web/src/lib/threadSort.ts` — Integrated the parent runtime's new `activeThreadAnchorTimestampMs` export.

## Parent changes intentionally omitted

- `.github/workflows/release.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.36-nightly.20260827.1206`
- Previously integrated parent nightly: `v0.0.35-nightly.20260826.1195`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/features/usage/usageProviders.ts` — Cursor and Kimi remain available on the mobile usage page with their labels and custom colors.
- `apps/mobile/src/features/usage/usageProviders.ts` — T3 Pretty's full provider series/table order remains Codex, Claude, Cursor, Grok, then Kimi.
- `apps/mobile/src/features/usage/usageProviders.ts` — Theme-aware provider coloring remains compatible with T3 Pretty's appearance preferences.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — T3 Pretty's model-aware Grok reasoning-effort menus and requested-effort selection remain available, preserving correct effort advertisement by model.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — T3 Pretty's KeyedLock-based per-thread serialization remains authoritative.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — The bounded Grok runtime-event PubSub remains in place to preserve memory and cross-surface reliability safeguards.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — Pending Grok user-input requests are still removed through acquire/use/release cleanup on success, failure, or interruption.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — Interruption-safe approval bookkeeping through Effect.acquireUseRelease, ensuring pending approval entries are removed by a finalizer on success, failure, or interruption.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — T3 Pretty's hardened, stable permission-detail fallback instead of serializing missing provider descriptions into the approval summary.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — T3 Pretty's per-model Grok reasoning-effort menu presentation remains available around the parent's native reasoning-effort behavior.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — The fork's selection-result architecture is retained by binding through boundSelection and deriving boundModelId from its modelId.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — T3 Pretty's session-scoped Grok notification consumer and turn-liveness watchdog remain untouched.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — T3 Pretty's surrounding steering-turn reuse, plan-fallback clearing, prompt interruption, and settlement safeguards remain untouched.
- `apps/server/src/provider/Layers/GrokProvider.ts` — T3 Pretty's Grok discovery reliability safeguards remain intact: provider model-count limits, model-ID length validation, canonical base-model resolution, duplicate suppression, and bounded trimmed labels.
- `apps/server/src/provider/acp/AcpRuntimeModel.test.ts` — Preserved coverage for bounded summaries of invalid ACP configuration values, avoiding retention of full provider option menus in error output.
- `apps/server/src/provider/acp/AcpSessionRuntime.ts` — Preserved T3 Pretty’s functional ability to attach model/provider metadata—including metadata used by model-specific reasoning integrations—to ACP session model changes, now through the parent’s first-party API.
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts` — Existing T3 Pretty Grok provider behavior outside the superseded reasoning-effort copy remains intact, including custom model-ID normalization.
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts` — The T3-compatible Grok OAuth referrer override and spawn environment construction remain unchanged.
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts` — Existing model-selection no-op and reliability coverage is retained and adapted to the parent API.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — T3 Pretty's model-capability, model-selection, provider-bound, and option-bound contract imports remain intact.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — Grok reasoning-effort metadata and selection interfaces remain available, including optional per-model effort state and advertised choices.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — The optional reasoningEffort runtime input remains in its existing positional slot, and only allowlisted reasoning-effort values are emitted through --reasoning-effort.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — Reasoning effort remains compatible with every Grok launch mode rather than being displaced by the new permission arguments.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — The existing T3 Pretty model-specific Grok reasoning-effort menus, advertised metadata parsing, bounded model inspection, and fallback effort choices remain unchanged.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — The explicitly optional `currentReasoningEffort?: string | undefined` input remains available for compatibility with T3 Pretty callers.
- `apps/server/src/provider/acp/XAiAcpExtension.ts` — Preserved T3 Pretty's provider-input reliability hardening through contract-defined maximum lengths and question/option count limits used by the xAI ACP schemas.
- `apps/server/src/usage/UsageService.ts` — Bounded reads for persisted usage caches and bounded collection/release of LiteLLM HTTP response bodies remain in place.
- `apps/server/src/usage/UsageService.ts` — The usage scan semaphore remains, preserving serialized scans and cache consistency under concurrent requests.
- `apps/server/src/usage/UsageService.ts` — Kimi usage remains integrated through the configured Kimi home and `wire.jsonl` transcript discovery.
- `apps/server/src/usage/UsageService.ts` — Transcript walk truncation and unreadable-directory diagnostics remain authoritative, and roots are only eligible for stale-cache pruning after a complete readable walk.
- `apps/server/src/usage/usageScanCache.test.ts` — Preserved T3 Pretty's round-trip coverage for the /c.jsonl Grok usage record, supporting the fork's expanded Cursor, Grok, and Kimi usage-provider work.
- `apps/server/src/usage/usageScanCache.ts` — Preserved hardened cache decoding that requires file sizes to be nonnegative safe integers and mtimes to be finite, nonnegative numbers.
- `apps/server/src/usage/usageScanCache.ts` — Preserved the centralized isUsageProviderKind validation so T3 Pretty's full provider set, including fork-added Cursor and Kimi support, is not narrowed to the parent's explicit provider list.
- `apps/server/src/usage/usageScanCache.ts` — Preserved Grok support through the same centralized provider-kind guard.
- `apps/server/src/usage/usageTranscriptReader.ts` — Kimi transcript parsing remains available through parseKimiLine.
- `apps/server/src/usage/usageTranscriptReader.ts` — Transcript walks retain T3 Pretty's file, directory, and entry ceilings to prevent unbounded usage-page scans.
- `apps/server/src/usage/usageTranscriptReader.ts` — Transcript listings continue to expose truncation and unreadable-directory diagnostics through TranscriptListing.
- `apps/server/src/usage/usageTranscriptReader.ts` — Existing T3 Pretty callers using the string fileName argument and separate limits object remain compatible.
- `apps/server/src/usage/usageTranscripts.test.ts` — Preserved T3 Pretty's Kimi usage-provider integration by retaining the parseKimiLine import used by this test suite.
- `apps/server/src/usage/usageTranscripts.ts` — Kimi remains a supported usage provider, including its pre-parse `usage.record` gate, `wire.jsonl` parser, duplicate-event avoidance, token mapping, timestamp conversion, session/model bounds, dedupe key, and session-folder ID extraction.
- `apps/server/src/usage/usageTranscripts.ts` — Cursor remains explicitly recognized by the usage gate and continues to skip transcript parsing because its ACP session store does not persist token usage.
- `apps/server/src/usage/usageTranscripts.ts` — The expanded T3 Pretty provider switch remains exhaustive for Claude, Codex, Grok, Kimi, and Cursor instead of applying the parent's Codex fallback to fork-only provider kinds.
- `apps/web/src/assets/assetUrls.test.ts` — Asset URL origin-escape regression coverage for protocol-relative and absolute cross-origin URLs.
- `apps/web/src/assets/assetUrls.test.ts` — Validation coverage ensuring blank and whitespace-only attachment IDs are not queried.
- `apps/web/src/assets/assetUrls.test.ts` — Alignment coverage ensuring query results remain mapped to the original resource list when invalid attachments are skipped.
- `apps/web/src/assets/assetUrls.test.ts` — Existing coverage for environment-relative URL resolution and invalid environment base URLs.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Regression coverage for retaining oversized sidebar width preferences while applying a live CSS viewport clamp, which keeps resizing correct even when no resize event is received.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Coverage for computing the sidebar's live maximum width while preserving its minimum width on undersized layouts.
- `apps/web/src/components/threadSidebarWidth.test.ts` — T3 Pretty sidebar branding coverage requiring the generated /t3-pretty-mark.png asset and the desktop wordmark layout.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Coverage ensuring the environment-identification stage pill hides through its container-query wrapper before it can overflow the narrow sidebar header.
- `apps/web/src/components/usage/UsageProviderChart.test.ts` — Preserved T3 Pretty usage-chart test coverage for zero-filled Cursor, Grok, and Kimi provider bands.
- `apps/web/src/components/usage/usageProviders.ts` — Cursor remains represented on the usage page with its fork-provided label, color, and icon.
- `apps/web/src/components/usage/usageProviders.ts` — Kimi remains represented on the usage page with its fork-provided label, color, and icon.
- `apps/web/src/components/usage/usageProviders.ts` — The fork's expanded provider ordering remains composed around the parent Grok entry: Cursor, Grok Build, then Kimi.
- `docs/user/usage.md` — Usage reporting remains documented across Codex, Claude Code, Cursor, Grok, and Kimi.
- `docs/user/usage.md` — The Cursor-specific limitation remains documented: local sessions do not persist token usage, so its share remains zero.
- `docs/user/usage.md` — Disconnected and offline environments remain unscanned and are not automatically reconnected when Usage is opened.
- `packages/client-runtime/src/state/session.test.ts` — Preserved the T3 Pretty reliability regression test asserting that initial-config, prepared-connection, and session-state atoms all release idle subscriptions using SESSION_STATE_IDLE_TTL_MS.
- `packages/contracts/src/usage.ts` — Usage reporting remains available for Pretty's Cursor and Kimi integrations in addition to Claude, Codex, and Grok.
- `packages/contracts/src/usage.ts` — Kimi wire transcript and Cursor ACP session discovery remain documented, including the warning that Cursor currently yields no token usage.
- `packages/contracts/src/usage.ts` — Pretty's centralized provider-kind tuple remains authoritative for both the schema and provider-derived limits.
- `packages/contracts/src/usage.ts` — Usage model, time-zone, per-provider bucket, total bucket, and source-count limits remain intact.
- `packages/shared/src/themePreview.test.ts` — Theme-preview geometry assertions that keep desktop preview rendering stable across clients.
- `packages/shared/src/themePreview.test.ts` — OKLab canvas-base mixing assertions for the standard light and dark themes.
- `packages/shared/src/themePreview.test.ts` — The T3 Pretty reliability regression test requiring malformed OKLCH input to fall back to the original canvas color instead of producing an invalid color.
- `packages/shared/src/usageMerge.ts` — Preserved T3 Pretty's USAGE_MERGE_MAX_ENVIRONMENTS reliability safeguard by validating and merging only retainedEnvironments; excess environments remain represented through omittedEnvironmentCount.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/features/usage/usageProviders.ts` — The parent's first-party Grok provider remains included in the usage provider order.
- `apps/mobile/src/features/usage/usageProviders.ts` — The fork's former Grok label is replaced with the parent-native "Grok Build" label.
- `apps/mobile/src/features/usage/usageProviders.ts` — The parent's updated Grok dark-theme neutral color, #a1a1aa, replaces the fork's earlier #d4d4d8 value.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — Integrated the parent Grok reasoning-effort normalization helper alongside the fork's model-aware selection layer.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — Integrated validated, minimum-bounded turn inactivity timeout configuration and nanosecond conversion.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — Integrated the separate active-tool inactivity timeout, allowing long-running tools a longer liveness deadline.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — Integrated parent liveness signaling while Grok waits for user input and liveness resumption after the request settles; the resumption now also occurs through guaranteed release cleanup.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — The parent now signals session-turn liveness before opening and waiting on an ACP permission request and resumes liveness after the request resolves.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — The parent's first-party Grok startup reasoning-effort implementation replaces the fork-only startup filtering path: current effort is read from session setup, the requested option is read through getModelSelectionStringOptionValue, and both are supplied to ACP model selection.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — Session context reasoning-effort state now follows the parent's normalization and requested-versus-current fallback semantics.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — Adopted the parent's first-party Grok turn-level reasoning-effort implementation, replacing the fork-only selection path.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — Preserved the parent's deferred model and reasoning-effort application after prompt and attachment validation, including current-model tracking and normalized reasoning state updates in the downstream code.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — Avoided changing provider model state when prompt preparation or validation fails.
- `apps/server/src/provider/Layers/GrokProvider.ts` — Replaced the fork-only Grok reasoning-effort implementation with the parent's first-party ACP metadata implementation, including validated effort tokens, advertised defaults, descriptions, and current-value handling.
- `apps/server/src/provider/Layers/GrokProvider.ts` — Integrated the parent's Grok skills discovery dependency.
- `apps/server/src/provider/Layers/GrokProvider.ts` — Restored the parent capability fallback semantics so unsupported or undiscovered models do not receive speculative reasoning options.
- `apps/server/src/provider/acp/AcpRuntimeModel.test.ts` — Integrated the parent test dependency for ACP tool-call progress-length behavior.
- `apps/server/src/provider/acp/AcpSessionRuntime.ts` — Replaced the fork-only `_meta` options wrapper with the parent’s first-party direct `meta` parameter, as required for a native parent replacement.
- `apps/server/src/provider/acp/AcpSessionRuntime.ts` — Adopted `EffectAcpSchema.SetSessionModelRequest["_meta"]` so metadata remains aligned with the ACP request schema.
- `apps/server/src/provider/acp/AcpSessionRuntime.ts` — Adopted the explicit `meta !== undefined` forwarding behavior when constructing `SetSessionModelRequest`.
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts` — Integrated the parent `grokAcpSpawnArgs` permission-mode behavior, including forcing Supervised sessions to override an always-approve CLI configuration.
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts` — Replaced the fork's older Grok reasoning-effort copy with the parent's first-party ACP implementation and generic future-token validation.
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts` — Integrated the parent's direct `setSessionModel(modelId, meta)` metadata API instead of the fork's nested `_meta` wrapper.
- `apps/server/src/provider/acp/GrokAcpSupport.test.ts` — Integrated the parent's model-selection string return contract and structured metadata recording, including malformed-effort handling covered by the surrounding upstream tests.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — Imported RuntimeMode and added it to GrokAcpRuntimeInput.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — Integrated grokAcpSpawnArgs with the parent's approval-required, auto-accept-edits, auto, full-access, and default argument mappings.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — Propagated runtimeMode through makeGrokAcpRuntime into process spawning.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — Composed parent permission-mode arguments with T3 Pretty reasoning-effort arguments while retaining the parent's argument ordering and stdio transport.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — Replaced the fork-only Grok model/reasoning selection path with the parent’s first-party implementation, as required for a native parent replacement.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — Normalized requested reasoning efforts before comparison or forwarding and dropped invalid values instead of sending them to the ACP runtime.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — Preserved CLI-advertised defaults by distinguishing an omitted reasoning preference from an explicit same-model effort change.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — Adopted the parent `setSessionModel(targetModelId, reasoningMeta)` metadata contract and `string | undefined` result contract.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — Kept the parent’s guarded current-effort extraction, including missing-model-state handling, trimmed model identifiers, string validation, and normalization.
- `apps/server/src/provider/acp/GrokAcpSupport.ts` — Removed the duplicate fork-era current-effort extractor so the merged file has a single coherent exported implementation.
- `apps/server/src/provider/acp/XAiAcpExtension.ts` — Integrated the parent NodeOS namespace import needed by the upstream OS-aware xAI ACP implementation.
- `apps/server/src/usage/UsageService.ts` — Added the host process environment dependency and home-path expansion utility.
- `apps/server/src/usage/UsageService.ts` — Replaced the fork's hard-coded Grok directory discovery with the parent's first-party implementation: nonblank `GROK_HOME` is expanded and resolved, while blank or missing values fall back to `~/.grok`.
- `apps/server/src/usage/UsageService.ts` — Integrated the parent's object-based `listTranscriptFiles` filename-filter API for Grok and Kimi transcript filenames.
- `apps/server/src/usage/usageScanCache.test.ts` — Integrated upstream's /grok.jsonl round-trip assertion, including coverage of its Grok model and provider-specific dedupe key.
- `apps/server/src/usage/usageScanCache.test.ts` — Adjusted the expected restored cache size so both fork and upstream fixtures are validated coherently.
- `apps/server/src/usage/usageScanCache.ts` — Integrated the parent's addition of Grok as an accepted cached usage provider; isUsageProviderKind accepts it without narrowing T3 Pretty's broader provider support.
- `apps/server/src/usage/usageScanCache.ts` — Retained the parent's basic requirement that serialized size and mtime values be numbers, with T3 Pretty's stricter validity checks layered on top.
- `apps/server/src/usage/usageTranscriptReader.ts` — The parent first-party Grok parsing hook remains imported and active.
- `apps/server/src/usage/usageTranscriptReader.ts` — The parent's object-based `{ fileName }` calling convention is accepted for native Grok `updates.jsonl` selection.
- `apps/server/src/usage/usageTranscriptReader.ts` — The parent's behavior of matching an exact basename when configured and otherwise accepting `.jsonl` files is preserved without duplicating the predicate.
- `apps/server/src/usage/usageTranscripts.test.ts` — Integrated the parent nightly's first-party parseGrokLine import without changing its name or behavior.
- `apps/server/src/usage/usageTranscripts.ts` — Adopted the parent's first-party Grok Build transcript implementation in place of T3 Pretty's earlier fork-only Grok parser.
- `apps/server/src/usage/usageTranscripts.ts` — Integrated Grok parsing as a zero-or-more-record API, including per-model `usage.modelUsage` rows and aggregate fallback records.
- `apps/server/src/usage/usageTranscripts.ts` — Integrated the parent's Grok token normalization, zero-token filtering, high-resolution timestamp preference, prompt/model dedupe keys, and per-model cost allocation behavior.
- `apps/server/src/usage/usageTranscripts.ts` — Integrated the parent-defined Grok cost conversion of 10^10 ticks per USD, including validation through `grokCostTicksToUsd`.
- `apps/server/src/usage/usageTranscripts.ts` — Preserved the parent's usage substring gates for Claude, Codex, and Grok while composing them with T3 Pretty's additional providers.
- `apps/web/src/components/usage/UsageProviderChart.test.ts` — Integrated the parent test expectation that Grok is represented as a zero-filled provider band when it has no usage.
- `apps/web/src/components/usage/usageProviders.ts` — Adopted the parent's first-party Grok Build presentation in place of T3 Pretty's earlier fork-only Grok presentation.
- `apps/web/src/components/usage/usageProviders.ts` — Adopted the parent's contrast-aware Grok chart color using `color-mix` with theme variables.
- `apps/web/src/components/usage/usageProviders.ts` — Retained the parent Grok icon integration alongside the fork's additional provider icons.
- `docs/user/usage.md` — Documented that Grok Build totals are derived from persisted session updates.
- `docs/user/usage.md` — Documented that interactive Grok Build turns without completed-turn records are excluded from totals.
- `packages/client-runtime/src/state/session.test.ts` — Integrated the parent commit's trivial-test pruning by removing the inherited initialConfigOption failure-to-empty-value test, its TestConfigError fixture, and all now-unused Effect, Option, and Schema imports.
- `packages/contracts/src/usage.ts` — Added USAGE_MERGE_COMPATIBLE_SINCE = 4 so current clients can retain structurally compatible Claude/Codex totals from v4 environments.
- `packages/contracts/src/usage.ts` — Retained the parent's Grok provider and transcript-source coverage within Pretty's broader provider set.
- `packages/contracts/src/usage.ts` — Preserved the parent's mixed-version compatibility rationale while adapting its wording to avoid the inaccurate claim that Pretty's v5 adds only Grok.
- `packages/shared/src/usageMerge.ts` — Integrated upstream's backward-compatible contract-version handling through isCompatibleContractVersion, allowing versions from USAGE_MERGE_COMPATIBLE_SINCE through expectedContractVersion instead of requiring exact equality.

## Parent changes intentionally omitted

- `apps/server/src/provider/Layers/GrokAdapter.ts` — The parent's SynchronizedRef&lt;Map&lt;string, Semaphore.Semaphore&gt;&gt; thread-lock implementation.. Reason: T3 Pretty's KeyedLock is the authoritative fork locking abstraction and is already consumed by withThreadLock; replacing it would regress the fork's hardened lifecycle and lock-management behavior.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — The parent's unbounded ProviderRuntimeEvent PubSub.. Reason: T3 Pretty intentionally caps the Grok runtime-event buffer at GROK_RUNTIME_EVENT_BUFFER_CAPACITY to prevent unbounded memory growth under slow or disconnected consumers.
- `apps/server/src/provider/Layers/GrokAdapter.ts` — The parent/base fallback serializes permission parameters into the approval detail when the provider supplies no description.. Reason: T3 Pretty deliberately replaced that path with a stable hardened fallback string; restoring diagnostic serialization would regress the fork's cross-surface approval reliability behavior. The original arguments and raw payload remain attached separately to the event.
- `apps/server/src/usage/UsageService.ts` — Unconditionally add every existing transcript root to `walkedRoots` after attempting directory traversal.. Reason: T3 Pretty's reliability hardening requires proof of a complete, readable traversal before using absence to prune cached entries. Applying the parent behavior to truncated or partially unreadable walks could evict valid warm-cache records.
- `apps/server/src/usage/usageTranscriptReader.ts` — The parent side's array-only `Promise&lt;readonly TranscriptFile[]&gt;` return contract.. Reason: Restoring the array-only result would remove T3 Pretty's required truncation and unreadable-directory observability. The parent Grok option and filtering behavior are integrated while the fork's cross-surface reliability contract remains authoritative.
- `apps/web/src/assets/assetUrls.test.ts` — Deletion of apps/web/src/assets/assetUrls.test.ts as part of the parent low-signal test cleanup.. Reason: The fork materially expanded this file after the shared base with security and asset-alignment regression tests tied to recent T3 Pretty reliability fixes. No first-party replacement exists, so deleting it would remove authoritative fork test coverage.
- `apps/web/src/components/threadSidebarWidth.test.ts` — Delete threadSidebarWidth.test.ts as part of the parent's pruning of trivial error and layout tests.. Reason: The surviving T3 Pretty file is no longer merely a trivial parent layout test: it contains recent fork-specific regression coverage for resize-event-independent sidebar sizing, T3 Pretty branding, and stage-pill overflow behavior. No first-party replacement test exists, so deleting it would silently remove protections required by the fork.
- `packages/client-runtime/src/state/session.test.ts` — Deletion of packages/client-runtime/src/state/session.test.ts in its entirety.. Reason: The parent deleted a file that previously contained only the inherited trivial error test, but T3 Pretty subsequently added a material idle-subscription TTL regression test in its cross-surface reliability work. No first-party replacement for that fork-specific coverage is evidenced, so only the obsolete inherited test is removed.
- `packages/shared/src/themePreview.test.ts` — Parent deletion of packages/shared/src/themePreview.test.ts as a low-signal test file.. Reason: The surviving T3 Pretty version has since gained a material malformed-OKLCH fallback regression test from the fork's cross-surface reliability hardening, and the parent provides no replacement test or relocated coverage. Deleting the file would silently remove fork-specific compatibility protection.
- `packages/shared/src/usageMerge.ts` — Upstream's loop over every environment without applying the fork's environment-count bound.. Reason: This portion conflicts with T3 Pretty's cross-surface reliability safeguard. Only environments within USAGE_MERGE_MAX_ENVIRONMENTS are processed, while the remainder are explicitly counted as omitted.
- `.github/workflows/desktop-macos-preview.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.36-nightly.20260827.1207`
- Previously integrated parent nightly: `v0.0.36-nightly.20260827.1206`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/app.config.ts` — Preserved the T3 Pretty public Preview and Release adaptive-icon background color, #DFEFE3.
- `apps/mobile/app.config.ts` — Preserved the fork-branded Android icon mark for public builds, including the existing Release presentation.
- `apps/mobile/app.config.ts` — Kept Android public-build icon presentation within the T3 Pretty sage branding rather than restoring parent dark/candy artwork.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — Preserved T3 Pretty’s reduced-motion behavior by disabling the newly introduced spinner animation when reduced motion is requested; normal update-progress animation remains intact.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — Avoided reintroducing the old continuously bouncing advisory icon, retaining the fork’s hardened approach to nonessential animation.

## Parent changes integrated at conflict boundaries

- `apps/mobile/app.config.ts` — Integrated the parent's fix for rounded-square universal exports being unsuitable as Android adaptive foregrounds: Preview now uses the silhouette-free Android mark rather than nightlyLinuxIconPng.
- `apps/mobile/app.config.ts` — Kept adaptive foregrounds represented by a dedicated transparent mark for both Preview and Release, adapting the parent's implementation to the fork's branded asset.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — Integrated the parent’s versionAdvisory.detail text in the update popover.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — Integrated the parent’s optional one-click update button, including onRunUpdate handling, disabled state during updates, loading/download icons, and Updating/Update now labels.

## Parent changes intentionally omitted

- `apps/mobile/app.config.ts` — Use the parent's shared ./assets/android-icon-foreground.png asset for Preview and Release.. Reason: That parent asset selection would replace the fork's authoritative Pretty foreground presentation. The parent's adaptive-icon masking intent is preserved with the fork's existing Android mark instead.
- `apps/mobile/app.config.ts` — Restore the parent Preview background #111533 and Release background #000000.. Reason: Those dark parent colors conflict with T3 Pretty's intentional pastel sage adaptive-icon plate, #DFEFE3.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — Animating the update progress spinner when the user has requested reduced motion.. Reason: T3 Pretty’s reduced-motion presentation is authoritative. The spinner still animates normally and only becomes static under the reduced-motion media preference.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.36-nightly.20260828.1209`
- Previously integrated parent nightly: `v0.0.36-nightly.20260828.1208`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/features/threads/GitActionProgressOverlay.tsx` — Preserved T3 Pretty's native mobile pull-request manager by retaining useOpenNativePullRequest; tapping a completed action with a PR URL continues to open the native PR experience rather than leaving the app for an external URL.
- `apps/mobile/src/lib/threadActivity.ts` — T3 Pretty's centralized deriveWorkLogEntry filtering architecture, which keeps work-log derivation consistent for incremental and full-feed processing.
- `apps/mobile/src/lib/threadActivity.ts` — T3 Pretty's mobile work-log behavior that excludes generated turn headlines, transient tool/task activity, checkpoints, plan-boundary tools, and agent-internal activity while retaining terminal Codex child-task updates.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The compact T3 Pretty work-group toggle typography, spacing, hover treatment, custom easing, and reduced-motion fallback remain intact.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Collapsed groups containing failures continue to show Pretty's visible destructive X indicator with an accessible failure description.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Pretty's neutral in-progress tool-status handling remains imported for the existing empty/neutral marker UX.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Plain tool rows retain Pretty's compact size-4 icon wrapper, muted treatment for ordinary tool failures, and destructive runtime-warning presentation.
- `apps/web/src/session-logic.test.ts` — Preserved T3 Pretty's regression coverage ensuring generated turn headlines remain excluded from the work log while ordinary completed tool entries remain visible.
- `apps/web/src/session-logic.ts` — Preserved T3 Pretty's generated live-status headline lookup for the active turn, including stable last-match behavior and its exported API.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/features/threads/GitActionProgressOverlay.tsx` — Integrated the parent mobileTheme themeColorWithAlpha utility used to derive adaptive glass tint and border colors in OverlayContent.
- `apps/mobile/src/lib/threadActivity.ts` — Suppress runtime.warning activities whose summaries end with “(no displayable text content)”, using the parent's isNoContentRuntimeWarning helper within the fork's centralized derivation function.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Imported `workEntrySignalsSevereFailure`, allowing the surrounding parent severe-failure classification to distinguish severe failures from ordinary tool failures.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Added the parent's contextual `aria-label` announcing when a collapsed work group includes a failure.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Applied the parent's `row.hasFailure && !row.expanded` criterion through `showHiddenFailure`, so failure messaging and the Pretty indicator appear only while affected entries are hidden.
- `apps/web/src/session-logic.test.ts` — Integrated the parent regression test that drops runtime warnings lacking displayable content while retaining warnings with a meaningful preview.
- `apps/web/src/session-logic.ts` — Integrated the parent helper that recognizes wire-only SDK runtime warnings with no displayable content, allowing deriveWorkLogEntries to suppress those non-actionable rows.

## Parent changes intentionally omitted

- `apps/mobile/src/features/threads/GitActionProgressOverlay.tsx` — Parent import and implied use of tryOpenExternalUrl for PR links.. Reason: T3 Pretty already routes PR URLs through its fork-specific native pull-request manager. Retaining the external opener would be unused in the resolved implementation and switching to it would regress authoritative native mobile PR behavior.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The parent's roomier `min-h-6`, `text-sm`, reduced-gap work-group toggle styling and generic 200ms disclosure animation.. Reason: These directly replace T3 Pretty's authoritative compact row design, hover behavior, custom animation curve, and explicit reduced-motion handling.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The parent's always-chevron work-group presentation, which removes the visible collapsed-failure X indicator.. Reason: T3 Pretty intentionally keeps hidden failures visually discoverable instead of exposing them only through an accessible label.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The parent's size-6 plain-row icon wrapper and `text-warning` color for runtime-warning icons.. Reason: T3 Pretty's compact icon geometry and destructive X treatment for runtime warnings are fork-specific visual behavior; the compatible parent severe-failure classifier is retained separately.
- `.github/workflows/release.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.36-nightly.20260828.1210`
- Previously integrated parent nightly: `v0.0.36-nightly.20260828.1209`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/server/src/provider/Layers/OpenCodeAdapter.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/server/src/provider/opencodeRuntime.cliParsers.test.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/server/src/provider/opencodeRuntime.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/server/src/textGeneration/OpenCodeTextGeneration.test.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/server/src/textGeneration/OpenCodeTextGeneration.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/desktop/src/preload.ts` — Preserved T3 Pretty's preload listener and cached window-active state so renderer subscribers can recover state emitted before React effects attach.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — T3 Pretty's user-image source resolution, including local preview URI backfill keyed by message ID.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — T3 Pretty's user-only review-comment and wide-markdown bubble sizing logic, including avoiding unnecessary full-text scans for assistant rows.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Existing mobile image rendering and image-tap behavior remain fed by the normalized user image sources.
- `apps/mobile/src/lib/authClientMetadata.ts` — The authentication client remains branded as "T3 Pretty Mobile" rather than being renamed to "T3 Code Mobile".
- `apps/server/src/assets/AssetAccess.ts` — Preserved the mandatory resolved-asset source classification used to drive response caching and CORS behavior.
- `apps/server/src/assets/AssetAccess.ts` — Preserved attachment IDs on resolved attachment assets for T3 Pretty's attachment-aware behavior.
- `apps/server/src/assets/AssetAccess.ts` — Preserved Grok generated-image asset resolution, including basename validation, canonical allowed-root enforcement, and the generated-image source classification.
- `apps/server/src/assets/AssetAccess.ts` — Preserved source classifications for workspace files and project favicons through the composed ResolvedAsset type.
- `apps/server/src/environment/ServerEnvironment.test.ts` — The environment descriptor continues to advertise voice dictation only when host dictation is available.
- `apps/server/src/environment/ServerEnvironment.test.ts` — The environment descriptor continues to advertise read-aloud support only when host voice support is available.
- `apps/server/src/http.test.ts` — Bounded JSON request-body tests continue to protect exact-limit acceptance and immediate rejection once streamed bytes exceed the configured limit.
- `apps/server/src/http.test.ts` — Fork-specific asset-source policies remain covered: immutable attachment caching, cross-origin access for attachments, workspace files, and generated images, and restricted project favicons.
- `apps/server/src/http.test.ts` — Static client asset tests continue to protect immutable caching for hashed Vite assets, no-cache handling for HTML/unhashed files, and Brotli Accept-Encoding detection.
- `apps/server/src/http.test.ts` — Desktop and networking safeguards remain covered by disabling permessage-deflate for the t3code desktop origin and loopback peers while retaining it for LAN/tunneled clients and stripping only the relevant extension offer.
- `apps/server/src/http.ts` — T3 Pretty's OTLP request-body JSON decoder retains its required effect/Schema import.
- `apps/server/src/http.ts` — Asset cache policy remains source-aware, including immutable caching for attachment bytes.
- `apps/server/src/http.ts` — Signed attachment, workspace-file, and generated-image capability URLs retain wildcard cross-origin access for desktop, remote, and generated-image surfaces.
- `apps/server/src/http.ts` — Attachment feed-preview variant requests continue resolving through resolveAttachmentFeedPreview before serving the file.
- `apps/server/src/http.ts` — Existing callers that pass a ResolvedAssetSource directly to assetResponseHeaders remain supported.
- `apps/server/src/http.ts` — Inline HTML content typing and the existing sandboxed SVG content-security policy remain active for non-download assets.
- `apps/server/src/http.ts` — The asset route remains wrapped with HttpMiddleware.withLoggerDisabled.
- `apps/web/src/connection/platform.ts` — T3 Pretty remains the client presentation identity for both desktop and web labels.
- `apps/web/src/connection/platform.ts` — Any additional label context produced by the parent helper is retained; only the `T3 Code` brand token is changed.
- `packages/contracts/src/auth.ts` — Preserved T3 Pretty's NonNegativeInt schema import used by its hardened cross-surface authentication contracts.
- `packages/contracts/src/orchestration.test.ts` — Provider-driver runtime-mode contract coverage remains available, including T3 Pretty's default, display, effective, and resolution helpers used to protect provider-specific behavior such as Kimi Yolo/full-access handling.
- `packages/contracts/src/orchestration.test.ts` — The client turn attachment-count safeguard remains tested at the configured maximum and immediately above it.
- `packages/contracts/src/orchestration.test.ts` — T3 Pretty's contract-test coverage dependencies for project/workflow script limits, ranked thread-search limits, provider interaction and user-input limits, and attachment-count limits are retained.
- `packages/contracts/src/orchestration.test.ts` — World Scenery contract coverage remains intact through the thread scenery photo type and scenery URL length limit imports.
- `packages/contracts/src/orchestration.ts` — T3 Pretty's explicit maximum lengths and trimmed non-empty schemas for orchestration titles, branches, and paths.
- `packages/contracts/src/orchestration.ts` — T3 Pretty's large enabled-skill-ID character budget used by thread-start and skills behavior.
- `packages/contracts/src/orchestration.ts` — T3 Pretty's allocation-free image data-URL inspection, including canonical base64 validation, bounded headers and decoded size, and MIME matching support.

## Parent changes integrated at conflict boundaries

- `apps/desktop/src/preload.ts` — Integrated the parent preload's `clientPlatform` initialization from Electron's sandbox-exposed `process.platform`, including its targeted oxlint suppression, so `getClientPlatform` remains functional.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Parent attachment handling now filters message attachments to image entries before image rendering and empty-assistant-message checks.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — The Android fixed-width handling for review comments and intrinsically wide markdown remains active through the existing user-row-scoped implementation.
- `apps/mobile/src/lib/authClientMetadata.ts` — Use Expo device information to report tablets as "tablet", phones as "mobile", and unrecognized device types as "unknown" instead of reporting every device as mobile.
- `apps/server/src/assets/AssetAccess.ts` — Added optional download disposition metadata to resolved attachment assets.
- `apps/server/src/assets/AssetAccess.ts` — Added caller-supplied attachment filename metadata to resolved attachment assets.
- `apps/server/src/assets/AssetAccess.ts` — Added caller-supplied attachment MIME type metadata to resolved attachment assets.
- `apps/server/src/environment/ServerEnvironment.test.ts` — Added coverage that the environment descriptor exposes the structured fileAttachments capability with a 50 MiB upload limit.
- `apps/server/src/http.test.ts` — Added the parent's downloadContentDisposition helper import and its filename-sanitization tests.
- `apps/server/src/http.test.ts` — Integrated secure download-header coverage for uploaded documents, including Content-Disposition, sandboxing, and octet-stream handling for executable/renderable content.
- `apps/server/src/http.test.ts` — Integrated support tests for claimed filenames and MIME types, including preservation of official Office Open XML MIME types.
- `apps/server/src/http.test.ts` — Integrated RFC 5987 non-ASCII filename encoding, quote/control-character sanitization, and safe handling of unpaired Unicode surrogates.
- `apps/server/src/http.ts` — Added the parent's RFC 6266 download Content-Disposition generation with sanitized ASCII fallback and UTF-8 filename\* support.
- `apps/server/src/http.ts` — Added the parent's safe download MIME validation, with HTML/XML and invalid MIME values falling back to application/octet-stream.
- `apps/server/src/http.ts` — Added the parent's restrictive download Content-Security-Policy and ensured download handling takes precedence over inline HTML/SVG handling.
- `apps/server/src/http.ts` — Integrated download, fileName, and mimeType metadata from resolved assets into asset responses.
- `apps/server/src/http.ts` — Retained the parent's Stream import alongside the fork-required Schema import.
- `apps/web/src/connection/platform.ts` — Adopted the centralized `clientPresentationMetadata` implementation.
- `apps/web/src/connection/platform.ts` — Passed hosted-static-app state, browser user agent, platform, touch-point count, desktop bridge, and app version into the parent metadata derivation, preserving its richer device and surface classification behavior.
- `packages/contracts/src/auth.ts` — Integrated the parent's ClientWebDeployment schema import for the newest authentication deployment contract.
- `packages/contracts/src/orchestration.test.ts` — Added OrchestrationMessage and ThreadMessageSentPayload schema dependencies for upstream's persisted-message compatibility coverage, including tolerance of future attachment types.
- `packages/contracts/src/orchestration.test.ts` — Added PROVIDER_SEND_TURN_MAX_FILE_BYTES for upstream validation coverage of malformed or oversized known file attachments.
- `packages/contracts/src/orchestration.test.ts` — Expanded the client attachment test to verify inline images, uploaded images, and uploaded non-image files together while retaining the fork's attachment-count test.
- `packages/contracts/src/orchestration.ts` — Added the upstream 50 MiB provider turn file-size limit.
- `packages/contracts/src/orchestration.ts` — Added the upstream persisted file attachment contract, including non-empty files and enforcement of the 50 MiB cap.
- `packages/contracts/src/orchestration.ts` — Added the upstream forward-compatible unknown attachment contract while excluding known image and file discriminators so malformed known attachments cannot bypass their constraints.

## Parent changes intentionally omitted

- `apps/server/src/provider/Layers/OpenCodeAdapter.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/server/src/provider/opencodeRuntime.cliParsers.test.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/server/src/provider/opencodeRuntime.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/server/src/textGeneration/OpenCodeTextGeneration.test.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/server/src/textGeneration/OpenCodeTextGeneration.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/web/src/connection/platform.ts` — The raw `T3 Code` branding in labels returned by the parent presentation helper.. Reason: T3 Pretty branding is authoritative for the fork; only the brand token is replaced, with all other parent-generated metadata and label context preserved.
- `.github/workflows/ci.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.37-nightly.20260829.1224`
- Previously integrated parent nightly: `v0.0.36-nightly.20260828.1210`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `pnpm-lock.yaml` — fork-only dependency entries are re-derived by lockfile regeneration against the merged package manifests
- `apps/server/src/provider/Drivers/OpenCodeDriver.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/server/src/provider/Layers/OpenCodeAdapter.test.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/server/src/provider/Layers/OpenCodeAdapter.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/server/src/provider/Layers/OpenCodeProvider.test.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/server/src/provider/Layers/OpenCodeProvider.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/server/src/provider/opencodeRuntime.environment.test.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/server/src/provider/opencodeRuntime.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/server/src/textGeneration/OpenCodeTextGeneration.test.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/server/src/textGeneration/OpenCodeTextGeneration.ts` — kept T3 Pretty's intentional removal of the OpenCode provider
- `apps/desktop/src/preview/Manager.test.ts` — Accessibility-tree normalization tests continue to enforce the maximum node count, aggregate byte budget, oversized-node skipping, accurate truncation counts, and fail-soft handling of malformed protocol responses.
- `apps/desktop/src/preview/Manager.test.ts` — The picture-in-picture test continues to verify that background throttling remains disabled while the native PiP window is active.
- `apps/desktop/src/preview/Manager.ts` — Pretty's screencast-first preview capture pipeline remains authoritative, including its capturePage fallback rather than forcing a new capture and JPEG encode inside frame delivery.
- `apps/desktop/src/preview/Manager.ts` — Frame-capture source ownership, background-throttling restoration, screencast shutdown, and idle control-session cleanup remain protected by the shared sourceState lifecycle.
- `apps/desktop/src/preview/Manager.ts` — Shared screencast timing state remains present across immutable session copies, preserving Pretty's capture pacing and hot-path efficiency behavior.
- `apps/desktop/src/preview/Manager.ts` — Recording frames continue to be sent to the live host WebContents where Pretty's renderer-side recorder resides, and are not delivered through a missing or destroyed host.
- `apps/desktop/src/preview/Manager.ts` — Concurrent recording and picture-in-picture consumers continue to share one frame-capture session without changing Pretty's consumer or session architecture.
- `apps/mobile/generated-uniwind-default-theme-variables.json` — T3 Pretty's World Scenery mobile identity remains the default in both light and dark modes, including its green-tinted screen, sheet, card, foreground, border, and subtle-state palette.
- `apps/mobile/generated-uniwind-default-theme-variables.json` — The light user-message presentation remains T3 Pretty's desktop-aligned pastel sage rather than the stock iOS blue bubble, including its foreground, muted foreground, skill, Markdown fence, and divider colors.
- `apps/mobile/generated-uniwind-default-theme-variables.json` — T3 Pretty's light drawer, backdrop, separator, wordmark, and chevron styling remains intact.
- `apps/mobile/generated-uniwind-default-theme-variables.json` — T3 Pretty's dark separator, wordmark, and chevron styling remains aligned with the World Scenery palette.
- `apps/mobile/package.json` — Preserved the fork-added expo-audio dependency required by T3 Pretty's host-routed voice dictation feature, adapting it from the SDK 56 line to the SDK 57 line.
- `apps/mobile/src/App.tsx` — T3 Pretty's Boring mobile theme continues to use the unmodified base navigation theme, preserving the restored T3 Chat presentation.
- `apps/mobile/src/App.tsx` — World Scenery continues to apply its light or dark native navigation background, card, and accent colors according to the selected appearance.
- `apps/mobile/src/App.tsx` — The selected appearance and theme identity remain available for native status-bar styling and fork-specific navigation theming.
- `apps/mobile/src/components/AndroidAnchoredMenu.tsx` — T3 Pretty's shared AnchoredMenu surface for both platforms, including the custom iOS liquid-glass presentation and Android blur fallback, remains authoritative.
- `apps/mobile/src/components/AndroidAnchoredMenu.tsx` — T3 Pretty's themed chrome fill and border, 16-point continuous radius, 268-point menu width, and system reduced-motion-aware entrance animation are preserved.
- `apps/mobile/src/components/AndroidAnchoredMenu.tsx` — The fork's semantic Android native ripple color and platform-specific press feedback are retained.
- `apps/mobile/src/components/AndroidAnchoredMenu.tsx` — The fork's accessibility-labeled dismissal control and extracted overlay architecture are preserved.
- `apps/mobile/src/components/AndroidAnchoredMenu.tsx` — The upstream AndroidAnchoredMenu path and deprecated compatibility export remain intact for nightly merge stability.
- `apps/mobile/src/components/CompactBrandTitle.tsx` — The T3 Pretty generated wordmark remains unmodified by a parent accent-color override.
- `apps/mobile/src/components/CompactBrandTitle.tsx` — The Pretty name, stage label, and existing T3 Pretty accessibility identity remain intact.
- `apps/mobile/src/components/CompactBrandTitle.tsx` — Both text elements explicitly default allowFontScaling to true, preserving the fork's Android font-scaling and accessibility behavior.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Per-attachment preparing state and composer-wide busy state continue to dim thumbnails while images are being read or sent.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Preview interaction remains disabled and remove controls remain hidden while an attachment is preparing or the turn is sending.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — The animated busy overlay, including system reduced-motion handling and accessibility isolation, remains intact.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — T3 Pretty's reusable ComposerAttachmentThumb structure, accessibility labels and roles, and configurable overlay/gutter remove-button placement remain intact.
- `apps/mobile/src/components/ComposerToolbar.tsx` — Composer send buttons retain their in-flight loading state: the primary treatment remains undimmed rather than appearing ordinarily disabled.
- `apps/mobile/src/components/ComposerToolbar.tsx` — ComposerSendIconSlot continues to provide a stable icon position and swaps the send icon for the themed spinner while a message is being delivered or queued.
- `apps/mobile/src/components/ComposerToolbar.tsx` — The loading spinner continues to use the resolved primary-foreground theme color required by the native indicator.
- `apps/mobile/src/components/ComposerToolbar.tsx` — The chevron remains hidden during loading, avoiding competing spinner and menu affordances.
- `apps/mobile/src/components/ComposerToolbar.tsx` — Existing busy accessibility state and loading-driven press disabling remain intact around the resolved hunks.
- `apps/mobile/src/components/ControlPill.tsx` — Primary controls retain their active primary fill and foreground tint while a send is loading instead of appearing disabled.
- `apps/mobile/src/components/ControlPill.tsx` — ComposerSendIconSlot continues to show send progress for icon nodes, symbol icons, and loading states with no supplied icon.
- `apps/mobile/src/components/ControlPill.tsx` — The loading spinner receives a concrete theme-resolved color and remains consistent with T3 Pretty theming.
- `apps/mobile/src/components/ControlPill.tsx` — The existing fixed icon-slot behavior remains owned by ComposerSendIconSlot rather than introducing a redundant View wrapper.
- `apps/mobile/src/components/ErrorBanner.tsx` — Preserved the T3 Pretty mobile banner's enterFadeDown entrance animation, exitFade exit animation, and layoutSettle layout transition.
- `apps/mobile/src/components/ErrorBanner.tsx` — Preserved the existing rounded error-banner design, spacing, typography, and rose semantic presentation.
- `apps/mobile/src/components/LoadingScreen.tsx` — Preserved T3 Pretty's enter and exit fade animations on the mobile loading screen.
- `apps/mobile/src/components/LoadingScreen.tsx` — Preserved safe-area top padding, themed screen background styling, appearance-aware StatusBar content, and the existing branded loading UI.
- `apps/mobile/src/components/T3Wordmark.tsx` — The approved `t3-pretty-mark.png` mobile brand asset remains the rendered T3 mark.
- `apps/mobile/src/components/T3Wordmark.tsx` — The mark retains its fixed World Scenery sage presentation rather than being dynamically recolored by theme classes.
- `apps/mobile/src/components/T3Wordmark.tsx` — The bitmap retains contain-fit rendering and its native 480/351 aspect ratio.
- `apps/mobile/src/components/T3Wordmark.tsx` — The existing T3 accessibility label and height-driven sizing behavior remain intact.
- `apps/mobile/src/features/connection/ConnectionEnvironmentRow.tsx` — The connection-row chevron continues to rotate smoothly over 250ms with the fork's cubic easing rather than jumping directly between angles.
- `apps/mobile/src/features/connection/ConnectionEnvironmentRow.tsx` — Chevron motion continues to honor the operating system's reduced-motion preference through ReduceMotion.System.
- `apps/mobile/src/features/connection/ConnectionEnvironmentRow.tsx` — The chevron remains themed through a semantic subtle-icon color token.
- `apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx` — Retained the shared remote-pairing host, token, and URL maximum-length constants that protect T3 Pretty's deep-link and connection-input hardening.
- `apps/mobile/src/features/files/ThreadFilesRouteScreen.tsx` — T3 Pretty's mobile text-search query length limiting and normalization support remains imported through limitMobileSearchQuery and MOBILE_TEXT_SEARCH_QUERY_MAX_LENGTH.
- `apps/mobile/src/features/files/thread-file-navigator-pane.tsx` — T3 Pretty's mobile search-query hardening remains active through limitMobileSearchQuery and MOBILE_TEXT_SEARCH_QUERY_MAX_LENGTH.
- `apps/mobile/src/features/home/HomeHeader.tsx` — The Android home header continues to render the generated T3 Pretty CompactBrandTitle rather than the parent T3 Code lockup.
- `apps/mobile/src/features/home/HomeHeader.tsx` — T3 Pretty's explicit Android 48-point header controls, clear-search target sizing, spacing, and background styling remain intact.
- `apps/mobile/src/features/home/HomeHeader.tsx` — The native pull-request manager remains directly accessible from the Android home header, with its icon adapted to the current theme API.
- `apps/mobile/src/features/home/HomeRouteScreen.tsx` — Preserved the React Native View import required by T3 Pretty's existing mobile home layout/presentation code.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Preserved the SceneryBackdrop integration used to render T3 Pretty's World Scenery on the mobile home screen.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Preserved scenery-aware chrome behavior through useSceneryChromeActive.
- `apps/mobile/src/features/home/WorkspaceConnectionTitle.tsx` — The CompactBrandTitle/brand node remains mounted for the lifetime of the native header slot and is hidden only with opacity, preventing the T3 Pretty title from remaining blank after reconnect.
- `apps/mobile/src/features/home/WorkspaceConnectionTitle.tsx` — Connection status remains an absolute overlay, avoiding header or thread-list layout shifts during connection-state changes.
- `apps/mobile/src/features/home/WorkspaceConnectionTitle.tsx` — Non-collapsible native-header views, JS-driven fading, and pointer-event handling remain intact for RNSScreenStackHeaderSubview reliability.
- `apps/mobile/src/features/home/WorkspaceConnectionTitle.tsx` — The hidden brand is removed from accessibility and interaction while status is visible, then restored immediately on reconnect.
- `apps/mobile/src/features/home/WorkspaceConnectionTitle.tsx` — T3 Pretty's status alignment correction, page-title/navbar typography, environment-settings action, and persistent brand presentation are preserved.
- `apps/mobile/src/features/projects/AddProjectScreen.tsx` — The non-collapsible native form-sheet wrapper that prevents keyboard-driven native-stack relayout from misclassifying the full-height scroll surface.
- `apps/mobile/src/features/projects/AddProjectScreen.tsx` — The virtualized and recycled LegendList folder browser, including estimated row sizing and stable key extraction for mobile performance.
- `apps/mobile/src/features/projects/AddProjectScreen.tsx` — Safe-area-aware bottom padding, automatic content-inset handling, horizontal spacing, and T3 Pretty sheet/card styling.
- `apps/mobile/src/features/projects/AddProjectScreen.tsx` — The integrated project controls, browse status, errors, loading state, browse-up row, filtered empty state, rounded grouping, and folder rows within the scrollable list header/content.
- `apps/mobile/src/features/projects/AddProjectScreen.tsx` — Keyboard tap handling and hidden vertical scroll indicator behavior.
- `apps/mobile/src/features/review/useNativeReviewDiffBridge.ts` — Collapsed review-comment state is reset whenever the review thread or section changes, preventing stale collapsed comments from leaking across review surfaces.
- `apps/mobile/src/features/settings/SettingsProjectGroupingRouteScreen.tsx` — Preserved the T3 Pretty mobile accessibility hardening that wraps the project-grouping radio options in a labeled radiogroup while retaining each option's radio role, checked state, and disabled state.
- `apps/mobile/src/features/settings/appearance/sections/ThemeAppearanceSection.tsx` — T3 Pretty's Boring theme identity, default-theme mapping, and Boring-theme detection remain intact.
- `apps/mobile/src/features/settings/appearance/sections/ThemeAppearanceSection.tsx` — World Scenery photo-set selection and its SceneryProvider integration remain present for the fork's photo themes.
- `apps/mobile/src/features/settings/appearance/sections/ThemeAppearanceSection.tsx` — The fork-specific appearance flow remains authoritative; the deleted generic parent theme-card selector is not reintroduced over T3 Pretty's Boring and World Scenery presentation.
- `apps/mobile/src/features/settings/appearance/sections/ThemeAppearanceSection.tsx` — T3 Pretty's local theme-color integration is retained for its remaining fork-specific appearance presentation.
- `apps/mobile/src/features/threads/GitActionProgressOverlay.tsx` — Git action progress notifications continue opening pull-request URLs through T3 Pretty's native pull-request manager rather than sending users to an external browser.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — World Scenery remains active on the new-task surface, including the scenery backdrop, daily-photo state, attribution data, dark-mode presentation state, and glass-card toolbar fade.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Composer selectors remain locked while incoming shares or image/task dispatches are in progress.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Pending image previews remain merged into the attachment strip, and preparation/sending status continues to reflect connection state.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — T3 Pretty's internal-build, host-routed native dictation remains guarded by server capability, prepared connection state, share transfer state, and dispatch state; cursor bounds and error reporting remain intact.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The Pretty project selector retains its muted underline theming while using the new parent theme API.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The optimistic thread-opening lifecycle remains authoritative: drafts or edited pending tasks are handled before navigation/RPC completion, failed starts can use the existing fallback queue path, and stale pull-request checkouts still produce a warning.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Host-routed voice dictation retains its controlled cursor state, including synchronization after dictated text and protection against selection moving beyond the prompt.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — World Scenery keeps its transparent composer dock, glass workspace-control treatment, and scenery-aware toolbar fade colors instead of being covered by fixed sheet chrome.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The fork's new-task workspace, branch, and selected-skills controls remain intact around the upstream command-menu additions.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Preserved the LegendList-based project list, including item recycling and the extracted renderProjectScope path used for mobile performance and reliability.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Preserved T3 Pretty's existing project-row rendering and theming ownership instead of replacing it with the parent's stale inline renderer.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — Preserved the surrounding empty-state, project-selection, and list invalidation behavior without introducing a mismatched ScrollView closing tag.
- `apps/mobile/src/features/threads/PendingApprovalCard.tsx` — Preserved T3 Pretty's cn-based conditional class composition rather than reverting to the parent's context-dependent template-literal closure.
- `apps/mobile/src/features/threads/PendingApprovalCard.tsx` — Preserved the shared responding state for disabling approval controls, keeping button interactivity synchronized with T3 Pretty's in-flight row dimming UX.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Provider-aware runtime-mode display and option application, including Pretty's model-switch and Yolo/full-access behavior.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Pretty's ranked composer trigger handling for app mentions, skills, and path results, together with its instant-apply model/settings picker UI.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Hardened composer and dictation lifecycle dependencies, alert handling, and Effect Option integration.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Pretty's attachment presentation path using ComposerAttachmentThumb rather than restoring direct React Native Image rendering.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Appearance-aware glass styling, theme-token shadows, focus-aware animation suppression, and the solid light/dark Reduce Transparency fallback.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Attachable Apps remain available alongside file results for path-style @ mentions, with Pretty’s app avatar colors and bare @slug insertion semantics.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Skill selections continue to use skillMentionToken, preserving names with spaces or other unusual characters.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Asynchronous path lookup continues to display the command popover while results are loading, even before the first item arrives.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Native pasted images retain dispatch/preparation guards, pending previews, cleanup, and a stable callback that avoids focused iOS editor snapshots and keyboard-session reloads.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Queue/steer delivery behavior, send-label consistency, duplicate-send protection, queue menu behavior, and in-flight tracking remain intact.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — T3 Pretty Live Activity arming and the T3 Pretty project-title fallback remain intact after successful local sends.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Pretty’s dark-mode ComposerSurface theming, reusable expanded/collapsed styling, layout animation, and focused-editor keyboard protections remain intact.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Keeps the collapsed ThreadModelIdentityCaption outside ComposerSurface, including Pretty's model, option, runtime, and advanced-settings interactions.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Keeps the expanded toolbar outside ComposerSurface with T3 Pretty's animated entrance/exit and eight-point vertical spacing.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Retains the fork's distinct collapsed-versus-expanded composer presentation.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — T3 Pretty's full Reanimated animation stack, shared motion timing, focus-aware cancellation, and reduced-motion handling remain available to the thread feed.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — T3 Pretty's existing useThemeColor-based feed theming remains intact while the parent hook is added alongside it.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Assistant attachments continue using Pretty's structured image descriptor, including stable keys, attachment identity, and local-preview compatibility.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — The mobile timeline retains Pretty's shimmering Thinking label, its compositor-friendly opacity animation, accessibility-hidden highlight copy, cancellation while inactive, and static reduced-motion behavior.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — Preserved T3 Pretty sidebar theming through useThemeColor, which supports the fork's custom mobile visual design and branding.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — Preserved usePresentedThreadShells so newly created or optimistically presented threads remain visible immediately instead of reverting to raw useThreadShells behavior.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — Preserved the fork's current sidebar state architecture without restoring the superseded mobilePreferencesAtom import.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Existing-thread settings re-present on the persisted home or catalog page through session.initialPage and presentation.setPage, preserving the recent live re-presentation and catalog-navigation fixes.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The page-aware ThreadSettingsPickerNavigator contract and hydration guard remain intact, preventing nested-stack hydration from resetting the persisted catalog page.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The fork's redesigned New Task/model-picker architecture remains authoritative; the previously removed nested NewTaskThreadSettingsRouteScreen is not resurrected.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Pretty's catalog filter presentation remains unchanged: only the legacy-model toggle marks the catalog as custom-filtered, rather than treating the fork's provider selection state as a generic filter.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Pretty sheet and header theme tokens remain in use for the solid sheet background and foreground tint, now read through the parent theme API.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The fork's extracted shared commit-and-close behavior remains intact for both home and catalog actions.
- `apps/mobile/src/features/threads/git/GitOverviewSheet.tsx` — Inspector-aware `loadInitialState` propagation to both selected-thread Git hooks, preventing hidden inspector content from eagerly loading Git state.
- `apps/mobile/src/features/threads/git/GitOverviewSheet.tsx` — Pending-action and pull-refresh refs that guard against duplicate asynchronous operations.
- `apps/mobile/src/features/threads/git/GitOverviewSheet.tsx` — Mounted-state lifecycle tracking used to avoid unsafe state work after the sheet unmounts.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Retained ServerProviderSkill and SkillId contract types required by T3 Pretty's mobile new-task skill selection and management flow.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Retained provider-aware effective runtime-mode resolution, including Kimi's Yolo default and remapping Yolo away from providers such as Grok that do not support it.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — The fork-only Monitoring thread status remains available and retains the same sky-colored status semantics as Working.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — The unified snoozed/settled shelf header remains intact, including 44-point touch height, persistent counts, dedicated icons, accessibility state and labels, sidebar spacing, and World Scenery-aware horizontal placement.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — World Scenery glass fill and border styling remains on pending-task and thread cards.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — The settle/snooze departure and landing animation remains wired into thread rows, including kind-gated shelf landing behavior.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Pretty's muted pin treatment and sidebar/screen selected-row color behavior remain intact.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — T3 Pretty's compact settled-history row retains its 44px minimum height, horizontal flex alignment, spacing, and vertical padding.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — T3 Pretty's sidebar-specific compact-row padding remains distinct from the standard thread-list padding.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Generated work-log image loading continues to use workspace-file asset URLs and workspace-relative path resolution.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Work-log row normalization remains memoized by the activities array, avoiding repeated derivation during copy-feedback and expansion repaints.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — The Copied indicator retains T3 Pretty's FadeIn/FadeOut animation, along with the existing Reanimated layout transitions.
- `apps/mobile/src/lib/mobileTheme.test.ts` — The Boring (T3 Chat) mobile theme detection and migration coverage remains available through isBoringMobileTheme.
- `apps/mobile/src/lib/mobileTheme.test.ts` — World Scenery remains the authoritative default mobile palette in both light and dark appearances.
- `apps/mobile/src/lib/mobileTheme.test.ts` — T3 Pretty's World Scenery screen, green primary, user-bubble, and skill-foreground colors remain explicitly protected by tests.
- `apps/mobile/src/lib/mobileTheme.test.ts` — The static mobile stylesheet remains required to match T3 Pretty's runtime default theme.
- `apps/mobile/src/lib/mobileTheme.ts` — T3 Pretty's default mobile theme continues to source `DEFAULT_MOBILE_THEME_VARIABLES`, preserving its World Scenery palette and customized default iOS greens.
- `apps/mobile/src/lib/mobileTheme.ts` — The fork's Boring/World Scenery preview implementation remains authoritative; only the `ThemePreviewColors` type is imported instead of restoring the generic standard-preview constant.
- `apps/mobile/src/lib/modelOptions.test.ts` — Preserved T3 Pretty's thread provider-group behavior: only the current provider is offered when thread handoff is unsupported, while all provider groups remain available when handoff is supported.
- `apps/mobile/src/lib/modelOptions.test.ts` — Preserved test coverage for the provider-context handoff behavior introduced by the fork's orchestration work.
- `apps/mobile/src/native/T3ComposerEditor.ios.tsx` — The iOS composer caret remains explicitly themed with `--color-primary`, preserving T3 Pretty's primary/World Scenery color presentation.
- `apps/mobile/src/native/T3ComposerEditor.ios.tsx` — Foreground, placeholder, chip, inline-skill, and file-icon colors continue to resolve from the active T3 Pretty theme, so fork palettes and branding remain authoritative.
- `apps/mobile/src/native/T3ComposerEditor.native.tsx` — The native composer caret remains explicitly themed with `--color-primary`, preserving T3 Pretty’s caret presentation that was absent from the parent hunk.
- `apps/mobile/src/native/T3ComposerEditor.native.tsx` — All composer text, placeholder, chip, skill, and file-icon colors continue to resolve through semantic theme variables, so T3 Pretty themes such as World Scenery remain effective.
- `apps/mobile/src/state/use-composer-drafts.test.ts` — Retained test coverage ensuring per-thread skill selections (`enabledSkillIds`) are cleared with sent new-task content while the selected model remains intact.
- `apps/mobile/src/state/use-composer-drafts.ts` — Composer image payloads remain outside the repeatedly rewritten drafts document; persistence strips data URLs and load rehydrates them from app-owned preview files.
- `apps/mobile/src/state/use-composer-drafts.ts` — Missing preview files continue to remove only unavailable attachments, while otherwise meaningful drafts remain intact.
- `apps/mobile/src/state/use-composer-drafts.ts` — Draft text and last-handoff prompts remain bounded by the provider input limit during decode and persistence.
- `apps/mobile/src/state/use-composer-drafts.ts` — Fork-specific draft state—including enabled skills, auto-PR selection, handoff prompts, and pull-request references—continues to survive normalization and persistence.
- `apps/mobile/src/state/use-composer-drafts.ts` — Persisted-state failures continue to propagate as ComposerDraftPersistenceError instead of silently replacing disk state, protecting lifecycle and flush safeguards from unnoticed data loss.
- `apps/mobile/src/state/use-composer-drafts.ts` — flushComposerDrafts still writes a fresh current snapshot even after a best-effort debounce failed and cleared its timer.
- `apps/mobile/src/state/use-composer-drafts.ts` — Retry-safe composer hydration uses a locally captured pending promise, marks drafts loaded only after successful hydration, clears stale load errors, and allows failed hydration to be retried instead of risking a pre-hydration overwrite.
- `apps/mobile/src/state/use-composer-drafts.ts` — Current in-memory drafts remain authoritative over older persisted drafts during hydration.
- `apps/mobile/src/state/use-composer-drafts.ts` — Clearing task content continues to remove imported-share receipts, handoff ownership, PR checkout references, and selected skills, while coupling the auto-PR override to workspace clearing.
- `apps/mobile/src/state/use-composer-drafts.ts` — Composer share imports continue returning both the skipped attachment count and the exact skipped attachment objects so fork cleanup and bounded-image behavior remain intact.
- `apps/server/src/auth/dpop.test.ts` — The DPoP replay-state retention test continues to require the complete 305-second proof window before removal.
- `apps/server/src/auth/dpop.test.ts` — The removal-tracking ServerSecretStore test double and namespace import remain available for the fork's replay cleanup coverage.
- `apps/server/src/auth/dpop.test.ts` — Existing replay-store error mapping coverage, including replay conflict and availability failure behavior, remains unchanged.
- `apps/server/src/auth/dpop.ts` — DPoP replay records remain retained for 305 seconds and are pruned asynchronously, with cleanup failures logged rather than disrupting authentication.
- `apps/server/src/auth/dpop.ts` — Replay-state creation and expiry scheduling remain one uninterruptible operation, ensuring an accepted proof stays single-use for the full acceptance window even if the protected operation later fails.
- `apps/server/src/auth/dpop.ts` — The generated replay-state secret name remains shared between record creation and scheduled removal.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts` — Preserved T3 Pretty regression coverage for atomic `project.transfer.import` receipt deduplication, including stable repeated dispatch results and the expected two-event atomic import record.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — Cross-environment thread transfers continue to import message projections with their IDs, turn associations, roles, timestamps, and non-streaming state.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — Transferred threads continue to import proposed plans, including implementation metadata and timestamps.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — Transferred threads continue to import activity history, including optional sequence values and payloads.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — Transferred thread messages continue to be analyzed chronologically to reconstruct completed turn projections and associate user and assistant messages.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — Native resume requests continue to create a guarded `starting` session projection using the thread's stored provider instance and runtime mode; missing thread projections remain safely ignored.
- `apps/server/src/orchestration/Layers/ThreadDeletionReactor.test.ts` — Preserved the T3 Pretty `runThreadDeletionCleanup` test and its typed deleted-event fixture.
- `apps/server/src/orchestration/Layers/ThreadDeletionReactor.test.ts` — Preserved explicit verification that thread deletion stops the provider session and closes both terminal and preview runtime surfaces.
- `apps/server/src/provider/Layers/ProviderRegistry.test.ts` — Preserved T3 Pretty's intentional removal of the unused OpenCode provider by not resurrecting OpenCode-specific registry tests or fixtures.
- `apps/server/src/provider/Layers/ProviderRegistry.ts` — T3 Pretty's intentional removal of the unused OpenCode provider remains complete; OpenCode-only probe and snapshot-merging logic is not restored.
- `apps/server/src/provider/Layers/ProviderRegistry.ts` — The fork's generic provider model merge remains intact, including retention of prior models and capability descriptors when refreshed snapshots are incomplete.
- `apps/server/src/provider/opencodeRuntime.inventory.test.ts` — OpenCode provider and agent integration reliability remains protected by inventory fallback regression coverage.
- `apps/server/src/provider/opencodeRuntime.inventory.test.ts` — Cross-platform CLI safeguards remain covered, including Windows command shims, oversized skill-output handling, and bounded draining of stdout and stderr.
- `apps/server/src/provider/opencodeRuntime.permissions.test.ts` — T3 Pretty’s OpenCode runtime behavior is not changed by this test-only resolution; approval-required and automatic modes continue to be covered with their existing supervised permission semantics.
- `apps/server/src/server.test.ts` — Authenticated initial server-config delivery remains covered for gzip compression, a valid digest, and the correct T3 Pretty environment identity.
- `apps/server/src/server.test.ts` — Digest-aware subscribeServerConfig behavior remains covered so clients do not receive a duplicate initial snapshot when their known config digest matches.
- `apps/server/src/server.test.ts` — The EnvironmentServerConfigSnapshot runtime schema import remains available for decoding and validating the compressed HTTP response.
- `apps/server/src/ws.ts` — Tool-progress RPC integration remains available for T3 Pretty's agent and provider progress UX.
- `apps/server/src/ws.ts` — The shell-stream broadcaster remains part of each WebSocket RPC layer, preserving terminal and orchestration streaming behavior.
- `apps/server/src/ws.ts` — Bootstrap launches continue to adopt only project-compatible existing threads, recover safely from duplicate-create races, reuse eligible worktrees, and avoid redundant worktree preparation.
- `apps/server/src/ws.ts` — Native provider-session resumes retain the dedicated native-resume thread title.
- `apps/server/src/ws.ts` — Bootstrap thread creation continues carrying Pretty's enabled skill IDs and optional per-thread subagent policy.
- `apps/server/src/ws.ts` — Server-settings updates continue using the subscription acquired with the other config streams, preserving the fork's cross-surface subscription reliability behavior.
- `apps/web/src/browser/ElectronBrowserHost.tsx` — Preserved T3 Pretty's resident preview-thread limit: non-resident dormant threads do not retain a mounted guest webview.
- `apps/web/src/browser/ElectronBrowserHost.tsx` — Preserved dormant-thread session continuity and rebuilding the guest from the tab's last URL when the thread becomes resident again.
- `apps/web/src/cloud/linkEnvironment.ts` — Preserved T3 Pretty's `normalizeSecureRelayUrl` import, which supports secure canonical relay matching and stale relay-link migration behavior.
- `apps/web/src/components/ChatMarkdown.tsx` — Preserved the generatedImagePaths dependency used by T3 Pretty's generated-image rendering and session-aware image behavior.
- `apps/web/src/components/ChatView.tsx` — The 15-second attachment-preview load timeout remains in place.
- `apps/web/src/components/ChatView.tsx` — Voice dictation and read-aloud remain restricted to internal builds and servers that explicitly advertise their respective capabilities.
- `apps/web/src/components/ChatView.tsx` — Per-turn runtime mode continues to be resolved through the selected provider driver.
- `apps/web/src/components/ChatView.tsx` — Attachment-only bootstrap text is inserted before the auto-create-PR suffix so attachment-only first messages retain Pretty's PR instruction behavior.
- `apps/web/src/components/ChatView.tsx` — The legacy in-chat working-step label remains removed, preserving T3 Pretty's custom live/generated-headline presentation and duplicate-thinking cleanup.
- `apps/web/src/components/ChatView.tsx` — Plan follow-up prompting retains the existing requirements for no pending user input, plan mode, a settled turn, and an actionable proposed plan.
- `apps/web/src/components/ChatView.tsx` — File-derived thread titles continue to use T3 Pretty's attachedFilesSnapshot, representing the files selected for the outgoing message.
- `apps/web/src/components/ChatView.tsx` — The scroll-to-end pill retains T3 Pretty's mount-rise-in visual animation.
- `apps/web/src/components/ChatView.tsx` — The draft hero headline retains its transition ref, mount-rise-in animation, and data-scenery-hero-chrome hook used by T3 Pretty's World Scenery presentation.
- `apps/web/src/components/ChatView.tsx` — ChatComposer continues receiving the T3 Pretty host-routed voice-dictation capability.
- `apps/web/src/components/Sidebar.tsx` — T3 Pretty's `countThreadsAwaitingUser` sidebar logic remains imported and available.
- `apps/web/src/components/Sidebar.tsx` — T3 Pretty's thread conversation copy action remains connected through `useCopyThreadConversation`.
- `apps/web/src/components/Sidebar.tsx` — The selected sidebar project scope remains persisted under `PROJECT_SCOPE_KEY` with `ProjectScopeKeySchema`, surviving remounts and reloads.
- `apps/web/src/components/chat/ChatComposer.tsx` — Host-routed voice dictation remains exposed through supportsVoiceDictation and MicIcon.
- `apps/web/src/components/chat/ChatComposer.tsx` — Composer send-state derivation continues to count T3 Pretty canvas-selection context.
- `apps/web/src/components/chat/ChatComposer.tsx` — Composer send-state derivation continues to count fork-managed attached files through fileAttachmentCount.
- `apps/web/src/components/chat/ChatComposer.tsx` — Prompt-stash in-flight deduplication retains the fork's escaped NUL delimiter representation and existing target/prompt identity.
- `apps/web/src/components/chat/ChatComposer.tsx` — Thread-scoped attachment validation reports only actual failures and does not clear unrelated errors produced by failed sends or overlapping asynchronous work.
- `apps/web/src/components/chat/ChatComposer.tsx` — Pending image-compression reservations are published immediately through setPendingImageCompressions, preserving concurrent-paste capacity checks and composer state reliability.
- `apps/web/src/components/chat/ChatComposer.tsx` — The composer API memo remains keyed to activeThreadId rather than the entire activeThread object, matching the fork's thread-ID-based terminal-context behavior.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Canvas selections continue to render as UserMessageCanvasSelectionCard entries.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Canvas-selection images remain matched by the canonical selection-specific filename, with the existing index fallback.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The FrameIcon import required by T3 Pretty presentation remains available.
- `apps/web/src/components/preview/PreviewAutomationHosts.tsx` — Dormant preview threads are awakened and their guests remain resident for the entire automation request, then are reliably released.
- `apps/web/src/components/preview/PreviewAutomationHosts.tsx` — Desktop automation status polling remains bounded by the request deadline, preventing a bridge status call from hanging beyond the operation timeout.
- `apps/web/src/components/preview/PreviewAutomationHosts.tsx` — Preview target selection remains synchronized with the latest session snapshot and retains Pretty's structured unavailable-target error details.
- `apps/web/src/components/preview/PreviewAutomationHosts.tsx` — Open operations retain atomic default-viewport mutation and runtime-current assertions.
- `apps/web/src/components/preview/PreviewAutomationHosts.tsx` — Mini-player presentation retains explicit undismissal, per-tab dismissal semantics, configured auto-open behavior, and brief presentation settlement without failing background-thread operations.
- `apps/web/src/components/preview/PreviewAutomationHosts.tsx` — Reused-tab navigation retains URL resolution, runtime-current validation, and navigation-readiness waiting.
- `apps/web/src/components/preview/PreviewAutomationHosts.tsx` — Agent browser activity remains watchable through Pretty's existing automation presentation behavior.
- `apps/web/src/components/settings/KeybindingsSettings.tsx` — T3 Pretty branding remains in both the unknown-condition warning and the browser shortcut notice.
- `apps/web/src/components/settings/KeybindingsSettings.tsx` — The fork's source visibility remains available through the upstream KeybindingSourceBadge rendered with each row title.
- `apps/web/src/components/settings/KeybindingsSettings.tsx` — The fork-only action for discarding unsaved edits to an existing keybinding is reapplied to the upstream KeybindingKeyControl and resets the complete row draft safely.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — The update loader continues to stop its spinning animation when the user requests reduced motion, while remaining animated normally.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — T3 Pretty's existing provider-card styling, update emphasis colors, status presentation, and read-only behavior remain unchanged around the parent popover implementation.
- `apps/web/src/components/settings/ThemeSettings.tsx` — The branded T3 Pretty Personalization experience remains authoritative, with World Scenery and the expanded photo-theme collection rendered as first-class selectable cards.
- `apps/web/src/components/settings/ThemeSettings.tsx` — The fork's persisted photo-set selection remains connected to the World Scenery theme identity.
- `apps/web/src/components/settings/ThemeSettings.tsx` — Boring mode continues to restore the original T3 Chat palette and disable scenery photos, including its searchable setting and accessible label.
- `apps/web/src/components/settings/ThemeSettings.tsx` — Color-scheme previews continue to use the selected Pretty photo theme or Boring palette across system, light, and dark modes.
- `apps/web/src/components/settings/ThemeSettings.tsx` — The compact Pretty-specific ThemeLibrary API and visual layout are preserved instead of being replaced by the parent's removed generic theme-editor architecture.
- `apps/web/src/composerDraftStore.ts` — The exported DraftStartSurface type continues to support both chat and T3 Pretty's canvas thread-start surface.
- `apps/web/src/composerDraftStore.ts` — Canvas selections remain explicitly treated as session-bound composer context that prompt-stash clearing must preserve.
- `apps/web/src/composerDraftStore.ts` — Enabled skill IDs continue to travel with a moved prompt and are cleared from the source draft, preventing stale duplicate per-thread skill selections.
- `apps/web/src/hooks/useHandleNewThread.ts` — The shell-only `useThreadShell` subscription remains in place instead of reverting to the broader `useThread` hook, preserving T3 Pretty’s entity-read and efficiency architecture.
- `apps/web/src/hooks/useHandleNewThread.ts` — Carried models retain provider options such as reasoning effort and context window when no target-project model default takes precedence.
- `apps/web/src/hooks/useHandleNewThread.ts` — Runtime/permission mode and interaction mode continue to carry independently, including T3 Pretty’s Kimi-only yolo remapping for a destination on another provider and the surrounding unset semantics for plain full-access carries.
- `apps/web/src/hooks/useHandleNewThread.ts` — Branch, worktree, and environment mode remain non-carrying by default and continue to come from configured defaults unless explicitly supplied.
- `apps/web/src/hooks/useTheme.ts` — T3 Pretty's ThemeSwapSource distinction remains available through the new options object.
- `apps/web/src/hooks/useTheme.ts` — System appearance changes continue to use the "system" source, preserving the source-aware terminator sweep and system-weather dissolve tempo.
- `apps/web/src/hooks/useTheme.ts` — User-driven whole-theme, appearance-mode, theme-half, and clear-theme-half changes continue to animate through T3 Pretty's custom theme-swap choreography.
- `apps/web/src/hooks/useTheme.ts` — The existing hidden-document, reduced-motion, rapid-toggle, and in-flight-sweep hard-cut safeguards remain intact.
- `apps/web/src/hooks/useThreadActions.ts` — Preserved T3 Pretty's current composer-draft handling by not reintroducing the removed clearDraftThread store subscription; the adjacent project-scoped draft cleanup remains unchanged.
- `apps/web/src/promptStashStore.test.ts` — Preserved T3 Pretty's use of PROVIDER_SEND_TURN_MAX_ATTACHMENTS for testing that stashed attachments are bounded by the provider send-turn limit.
- `apps/web/src/promptStashStore.ts` — Preserved T3 Pretty's PROVIDER_SEND_TURN_MAX_ATTACHMENTS import, which bounds orphaned pending-image recovery and unreadable-image records to the provider attachment limit.
- `apps/web/src/routes/__root.tsx` — Preserved the T3 Pretty What's New host used for the fork's post-update changelog experience.
- `apps/web/src/routes/__root.tsx` — Preserved the T3 Pretty Scenery host used by the fork's World Scenery visual theme behavior.
- `docs/internals/glossary.md` — Preserved T3 Pretty's existing glossary link targets for `ShellStream.ts` and `ToolProgress.ts`, avoiding silently redirecting any fork-authored citations to unrelated environment-theme documentation.
- `docs/internals/providers.md` — Preserved the T3 Pretty Kimi provider driver reference.
- `docs/internals/providers.md` — Preserved references for T3 Pretty's ACP session runtime and ACP terminal host integrations.
- `docs/user/composer.md` — Voice dictation remains documented for builds and connected environments that support voice features.
- `docs/user/composer.md` — Read-aloud controls for settled final agent responses remain documented, including stopping playback by selecting the control again.
- `docs/user/composer.md` — The fork's Groq host-processing and client credential-privacy behavior remains explicitly documented.
- `docs/user/mobile-appearance.md` — T3 Pretty's Appearance flow remains described as changing the overall look, covering World Scenery, the additional photo themes, Boring personalization, and color-scheme selection rather than renaming the flow back to generic themes.
- `docs/user/mobile-appearance.md` — The stored System setting remains identified as the color scheme, preserving the distinction between T3 Pretty personalization and System/Light/Dark mode selection.
- `docs/user/mobile-appearance.md` — Upstream card-selection instructions are expressed in T3 Pretty's Personalization terminology without altering its branded visual model.
- `infra/relay/src/auth/DpopProofs.ts` — Preserved DPoP replay-key length hardening, including SHA-256 hashing of oversized thumbprints and JTIs before database persistence.
- `infra/relay/src/auth/DpopProofs.ts` — Preserved the typed HttpApiError.Unauthorized contract used by the read-only DPoP verification path.
- `infra/relay/src/auth/DpopProofs.verifyAndConsume.test.ts` — Preserved T3 Pretty's regression test ensuring repeated read-only relay status verification uses `verify` without writing or consuming DPoP replay state, including access-token hash verification.
- `infra/relay/src/http/Api.test.ts` — Preserved T3 Pretty's `readDpopAuthenticatedCache` import, retaining coverage for the fork's hardened DPoP authentication cache behavior.
- `packages/client-runtime/src/authorization/layer.test.ts` — Preserved T3 Pretty's reconnect safeguard: a transient failure against an unchanged endpoint keeps the cached token for supervisor retry rather than forcing an unnecessary credential re-exchange.
- `packages/client-runtime/src/authorization/layer.test.ts` — Preserved the test description matching T3 Pretty's retained-token behavior.
- `packages/client-runtime/src/relay/managedRelayState.test.ts` — Preserved the AUTH_CREDENTIAL_MAX_LENGTH import supporting T3 Pretty's hardened authentication credential-length behavior and tests.
- `packages/client-runtime/src/relay/managedRelayState.ts` — Preserved the fork's SURGE_CONNECT_NAME-based branding for unknown managed-relay snapshot failures instead of restoring the parent hard-coded T3 Connect name.
- `packages/client-runtime/src/state/pullRequests.test.ts` — Preserved the T3 Pretty reliability test requiring pull-request activity/conversation and diff payload atoms to use PULL_REQUEST_LARGE_QUERY_IDLE_TTL_MS instead of the generic query TTL.
- `packages/client-runtime/src/state/pullRequests.test.ts` — Preserved coverage for both activity and diff atom idle-TTL behavior.
- `packages/client-runtime/src/state/pullRequests.ts` — Pull-request activity remains fresh for 20 seconds rather than reverting to the parent's 15-second policy.
- `packages/client-runtime/src/state/pullRequests.ts` — Inactive pull-request activity queries are disposed after PULL_REQUEST_LARGE_QUERY_IDLE_TTL_MS, preserving T3 Pretty's protection against retaining expensive query data.
- `packages/client-runtime/src/state/server.test.ts` — The fixture retains T3 Pretty's complete environment metadata and existing repositoryIdentity, connectionProbe, and serverConfigHttp capabilities.
- `packages/client-runtime/src/state/server.test.ts` — The fixture continues using DEFAULT_SERVER_SETTINGS rather than an incomplete empty settings object.
- `packages/client-runtime/src/state/server.test.ts` — The fixture remains statically checked with `satisfies ServerConfig` instead of bypassing validation with an `unknown` cast.
- `packages/client-runtime/src/state/server.ts` — Preserved T3 Pretty's dynamic server-config subscription and session-based initial snapshot hydration.
- `packages/client-runtime/src/state/server.ts` — Preserved the fallback from `initialConfigSnapshot` to digesting `initialConfig` for compatibility with sessions lacking the optimized snapshot.
- `packages/client-runtime/src/state/server.ts` — Preserved digest comparison to avoid unnecessary cache persistence while still immediately promoting the live configuration into state.
- `packages/client-runtime/src/state/server.ts` — Preserved the known-config digest sent to the subscription for efficient remote configuration synchronization and reconnect behavior.
- `packages/client-runtime/src/state/server.ts` — Preserved graceful subscription startup when initial configuration discovery fails.
- `packages/contracts/src/baseSchemas.ts` — Preserved the bounded, trimmed ProviderNativeSessionId schema and its exported type for native provider session resumption.
- `packages/contracts/src/baseSchemas.ts` — Preserved ENTITY_ID_MAX_LENGTH and its downstream use for bounded entity identifiers.
- `packages/contracts/src/baseSchemas.ts` — Preserved the ISO date-time maximum-length safeguard instead of reverting IsoDateTime to an unbounded string.
- `packages/contracts/src/environmentHttp.ts` — The NonNegativeInt base-schema import remains available for T3 Pretty's adjacent environment HTTP contracts.
- `packages/contracts/src/environmentHttp.ts` — EnvironmentAuthInvalidError continues to validate trace IDs with EnvironmentTraceId, preserving T3 Pretty's AUTH_IDENTIFIER_MAX_LENGTH hardening rather than reverting to an unbounded TrimmedNonEmptyString.
- `packages/contracts/src/relay.ts` — Retained T3 Pretty's auth-contract imports and associated relay credential, subject, identifier, client-label, OAuth-scope, proof-key, and expiry-limit schemas.
- `packages/contracts/src/relay.ts` — Retained the fork's NonNegativeInt relay contract dependency.
- `packages/contracts/src/relay.ts` — Kept RelayAuthInvalidError.traceId on RelayTraceId, preserving the fork's trimming and RELAY_TRACE_ID_MAX_LENGTH validation.
- `packages/contracts/src/rpc.ts` — Preserved the optional `knownConfigDigest` field on server-config subscriptions, retaining T3 Pretty's configuration synchronization behavior.
- `packages/contracts/src/settings.ts` — Preserved T3 Pretty's DismissedProviderUpdateNotificationKeys schema, including maximum list-length and per-value-length validation for persisted provider update dismissal keys.
- `packages/effect-codex-app-server/src/protocol.ts` — T3 Pretty's `maximumWireLineBytes` enforcement remains active for streamed input instead of allowing an unfinished decoded line to grow without the fork's bound.
- `packages/effect-codex-app-server/src/protocol.ts` — The typed `CodexAppServerWireLineTooLargeError` path remains connected through `handleFramedInput` for both ordinary chunks and EOF finalization.
- `packages/effect-codex-app-server/src/protocol.ts` — T3 Pretty's stateful wire framing and final-buffer flush remain authoritative, preserving cross-chunk and trailing unterminated-message reliability without duplicate remainder state.
- `patches/expo-modules-jsi@56.0.10.patch` — The intent of T3 Pretty's nested-build output workaround is not resurrected against an incompatible SDK 56 package: SDK 57 removes the patched expo-modules-jsi@56.0.10 artifact and its version-specific build script from the active dependency boundary.
- `patches/expo-modules-jsi@56.0.10.patch` — No T3 Pretty branding, mobile identity, delivery configuration, or other fork-owned mobile behavior is changed by removing this unreferenced patch file.
- `scripts/build-desktop-artifact.test.ts` — Desktop artifact minimization remains enforced for source maps, Effect source and generated API UI modules, declarations, package documentation, Playwright, and separately packaged DMG resources.
- `scripts/build-desktop-artifact.test.ts` — Resource-monitor staging continues to resolve default, blank, absolute, and repository-relative CARGO_TARGET_DIR values, protecting Pretty's redirected Cargo release builds and clean-checkout workflow.
- `scripts/build-desktop-artifact.ts` — T3 Pretty's desktop artifact exclusions for source maps, TypeScript declarations and Effect sources, documentation files, stray Playwright packages, unused Effect OpenAPI UI modules, and installer-only DMG artwork remain intact.
- `scripts/build-desktop-artifact.ts` — T3 Pretty's public/internal build flavor remains authoritative for Pretty product naming, application identity, and flavor-specific packaging behavior.
- `scripts/build-desktop-artifact.ts` — Existing fork callers that supply the build flavor in the original trailing positional slot remain compatible.

## Parent changes integrated at conflict boundaries

- `pnpm-lock.yaml` — took the parent nightly's generated lockfile wholesale instead of AI-splicing it
- `apps/desktop/src/preview/Manager.test.ts` — Added parent coverage requiring scripted OAuth and localhost popups to open as hardened real popup windows so their opener remains available.
- `apps/desktop/src/preview/Manager.test.ts` — Added parent coverage keeping foreground/background target=_blank dispositions inside the preview tab through navigation.
- `apps/desktop/src/preview/Manager.test.ts` — Added parent security coverage preventing about:, javascript:, file:, VS Code remote, and malformed URLs from receiving popup windows that cannot be hardened.
- `apps/desktop/src/preview/Manager.test.ts` — Captured the initial PiP send count before recording starts, enabling the parent assertion that starting recording does not emit an extra PiP frame.
- `apps/desktop/src/preview/Manager.ts` — Added per-session tracking of the last frame successfully sent to picture-in-picture and suppressed identical subsequent PiP deliveries while allowing recording delivery to continue.
- `apps/desktop/src/preview/Manager.ts` — Re-read the current frame-capture session and consumer set before delivery so an in-flight frame does not use stale consumer state.
- `apps/desktop/src/preview/Manager.ts` — Validated the current tab WebContents identity, session scope, and destruction state before delivering an in-flight frame.
- `apps/desktop/src/preview/Manager.ts` — Preserved the parent's post-delivery cache update, including its session-identity guard so a replaced session is not mutated by an older delivery.
- `apps/mobile/generated-uniwind-default-theme-variables.json` — Integrated the parent migration of the generated theme-variable artifact from a TypeScript module to pure JSON: the import, export declaration, comments, and TypeScript `satisfies` assertion are removed.
- `apps/mobile/generated-uniwind-default-theme-variables.json` — Integrated strict JSON structure, including quoted `light` and `dark` keys, valid comma placement, and JSON-only closing braces.
- `apps/mobile/package.json` — Integrated the parent upgrade from Expo SDK 56 to Expo SDK 57.
- `apps/mobile/package.json` — Integrated all parent version updates in the conflict for expo, expo-asset, expo-auth-session, expo-blur, expo-build-properties, expo-camera, expo-clipboard, expo-constants, expo-crypto, expo-dev-client, expo-device, expo-file-system, expo-font, expo-glass-effect, expo-haptics, expo-image, expo-image-picker, expo-linking, expo-network, and expo-notifications.
- `apps/mobile/src/App.tsx` — Adopted the new zero-argument useMobileNavigationTheme API.
- `apps/mobile/src/App.tsx` — Removed the obsolete useThemeColor import and unused statusBarBg lookup in line with upstream's translucent status-bar implementation.
- `apps/mobile/src/components/AndroidAnchoredMenu.tsx` — Migrated submenu, selected-state, normal, and destructive menu icons to SymbolView's semantic tintColorClassName API.
- `apps/mobile/src/components/AndroidAnchoredMenu.tsx` — Removed obsolete direct icon, subtle-icon, and danger color hook reads after adopting upstream's accent-aware SymbolView classes.
- `apps/mobile/src/components/CompactBrandTitle.tsx` — Migrated the Pretty label from manual theme/font styles to the parent's font-t3-medium and semantic text utility classes.
- `apps/mobile/src/components/CompactBrandTitle.tsx` — Migrated the stage label from manual theme/font styles to the parent's font-t3-bold, semantic color, tracking, and uppercase utility classes.
- `apps/mobile/src/components/CompactBrandTitle.tsx` — Removed obsolete useThemeColor lookups made unnecessary by the parent's class-based theming refactor.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Migrated the thumbnail placeholder background from useThemeColor and an inline resolved color to the parent's bg-subtle NativeWind theme utility.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Removed the obsolete useThemeColor import and background-color prop plumbing while retaining the fork's Reanimated dependency.
- `apps/mobile/src/components/ComposerToolbar.tsx` — SymbolView icons and chevrons now use the parent's tintColorClassName API and accent token classes for primary, danger, and default variants.
- `apps/mobile/src/components/ComposerToolbar.tsx` — Obsolete JavaScript-calculated border and filled-border colors are removed in favor of the existing class-based button chrome.
- `apps/mobile/src/components/ComposerToolbar.tsx` — Redundant inline shadow color, offset, opacity, and radius values are removed so the existing parent utility-class shadow styling is authoritative.
- `apps/mobile/src/components/ComposerToolbar.tsx` — The parent's streamlined inline style shape is adopted, with only the fork's loading-aware opacity condition retained.
- `apps/mobile/src/components/ControlPill.tsx` — ControlPill now uses upstream's semantic accent tint class names for primary, danger, and default icon variants.
- `apps/mobile/src/components/ControlPill.tsx` — SymbolView is migrated to upstream's tintColorClassName API instead of the former direct tintColor prop.
- `apps/mobile/src/components/ControlPill.tsx` — Upstream's class-based tint refactor is composed with the fork spinner by resolving the same selected class only where a concrete spinner color is required.
- `apps/mobile/src/components/ErrorBanner.tsx` — Adopted the parent's adaptive rose border, background, and text color utilities, retaining equivalent light/dark styling through the adaptive theme tokens.
- `apps/mobile/src/components/LoadingScreen.tsx` — Integrated upstream's removal of the StatusBar backgroundColor prop and its invalid screenBg reference while retaining translucent status-bar behavior.
- `apps/mobile/src/components/T3Wordmark.tsx` — The component now accepts the parent's optional `color?: ColorValue` and `colorClassName?: string` prop shape, preserving source compatibility with updated parent call sites.
- `apps/mobile/src/components/T3Wordmark.tsx` — The parent `ColorValue` type import is incorporated to support that public prop signature.
- `apps/mobile/src/features/connection/ConnectionEnvironmentRow.tsx` — Migrated the chevron from the imperative tintColor/mutedColor path to SymbolView's tintColorClassName using accent-icon-subtle.
- `apps/mobile/src/features/connection/ConnectionEnvironmentRow.tsx` — Removed the now-unneeded useThemeColor import while retaining all animation dependencies required by T3 Pretty.
- `apps/mobile/src/features/connection/ConnectionsNewRouteScreen.tsx` — Adopted the parent's useUniwindTheme import, matching the screen's upstream header icon color lookup and replacing the obsolete useThemeColor import.
- `apps/mobile/src/features/files/ThreadFilesRouteScreen.tsx` — Replaced the obsolete useThemeColor import with the parent's useUniwindTheme hook, matching the upstream theming refactor.
- `apps/mobile/src/features/files/thread-file-navigator-pane.tsx` — Replaced the obsolete useThemeColor import with the parent's useUniwindTheme integration, matching the foreground and sheet theme-token lookups in the component.
- `apps/mobile/src/features/home/HomeHeader.tsx` — Integrated the parent's useUniwindTheme migration required by the iOS home-header implementation.
- `apps/mobile/src/features/home/HomeHeader.tsx` — Removed obsolete Android useThemeColor values and converted the fork-only pull-request icon to SymbolView's class-based accent color styling.
- `apps/mobile/src/features/home/HomeRouteScreen.tsx` — Integrated the parent's useWindowDimensions import, supporting the new window-width-aware adaptive home layout behavior.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Removed HomeScreen's legacy useThemeColor import as done by the parent nightly, while retaining the fork-only scenery imports.
- `apps/mobile/src/features/home/WorkspaceConnectionTitle.tsx` — The parent's maxWidth constraint is applied to the absolute status overlay so long connection labels do not displace native trailing actions.
- `apps/mobile/src/features/home/WorkspaceConnectionTitle.tsx` — The parent's flexShrink behavior and statusOffset margin are applied to the status Pressable for constrained native headers.
- `apps/mobile/src/features/home/WorkspaceConnectionTitle.tsx` — The parent's accent-icon-muted color-class API is used for both the progress indicator and disconnected Wi-Fi symbol.
- `apps/mobile/src/features/projects/AddProjectScreen.tsx` — Migrated ActivityIndicator styling from a resolved runtime color to the parent's semantic colorClassName API.
- `apps/mobile/src/features/projects/AddProjectScreen.tsx` — Migrated browse-up and folder SymbolView styling to the parent's tintColorClassName API.
- `apps/mobile/src/features/projects/AddProjectScreen.tsx` — Removed the now-unnecessary accent-color hook value and callback dependency while retaining T3 Pretty's safe-area inset value.
- `apps/mobile/src/features/review/useNativeReviewDiffBridge.ts` — Pass the active Uniwind app theme into createNativeReviewDiffTheme and recompute the native review theme when appTheme changes.
- `apps/mobile/src/features/settings/SettingsProjectGroupingRouteScreen.tsx` — Adopted the parent mobile theme-aware `accent-icon` class for the selected grouping checkmark through `tintColorClassName`, replacing the direct `checkmarkColor` value.
- `apps/mobile/src/features/settings/appearance/sections/ThemeAppearanceSection.tsx` — Uniwind ScopedTheme support and getMobileUniwindThemeName are integrated so light, dark, and split system previews render under the correct parent runtime theme.
- `apps/mobile/src/features/settings/appearance/sections/ThemeAppearanceSection.tsx` — The parent cn utility is integrated for the updated class-based preview and mode-card styling.
- `apps/mobile/src/features/settings/appearance/sections/ThemeAppearanceSection.tsx` — PreviewPane now follows the parent's scoped-theme design and no longer accepts obsolete manually computed MobileThemeVariables.
- `apps/mobile/src/features/settings/appearance/sections/ThemeAppearanceSection.tsx` — The obsolete getMobileThemeVariables dependency is removed at this boundary in favor of the parent's runtime scoped-theme mechanism.
- `apps/mobile/src/features/threads/GitActionProgressOverlay.tsx` — Adopted the parent refactor from useThemeColor to useUniwindTheme, matching OverlayContent's new CSS-variable-based theme color lookup.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Added the parent ComposerCommandPopover/useComposerCommandMenu implementation for new-task drafts, including environment/project context, provider status, command-driven draft updates, and plan-mode interaction updates.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Migrated foreground, project underline, and toolbar-card color reads to the parent's useUniwindTheme token API.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Integrated the parent's clearModelSelection behavior when a successfully handed-off new-task draft is cleared, adapted to Pretty's earlier optimistic cleanup point.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Composer autocomplete now consumes skills from the parent's selected provider status API.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The upstream composer command-menu selection pipeline, trigger popover, loading state, and item-selection behavior are integrated and synchronized with dictation.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Upstream composer focus and blur tracking is restored.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The parent's `fadeSurface="sheet"` toolbar treatment is used when World Scenery is not active.
- `apps/mobile/src/features/threads/PendingApprovalCard.tsx` — Integrated the parent's adaptive rose and neutral background utilities for decline and session approval actions.
- `apps/mobile/src/features/threads/PendingApprovalCard.tsx` — Integrated the parent's adaptive rose and neutral text utilities for approval action labels across light and dark themes.
- `apps/mobile/src/features/threads/PendingApprovalCard.tsx` — Preserved the parent's disabled-while-responding behavior through the equivalent shared responding variable.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Added the parent's extracted useComposerCommandMenu hook so first-party command-menu behavior can run alongside Pretty-specific command extensions.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Applied the compatible portion of the ComposerSurface cleanup by removing its unused card and border theme-color lookups.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Replaced the local trigger detection, path-search state, menu ranking, and general command-selection implementation with the parent’s useComposerCommandMenu hook.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Adopted the parent hook’s controlled editor selection, selection-change callback, item loading state, and command-selection behavior for built-in commands, provider commands, paths, and normal mode updates.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Adopted the parent’s non-null skills array contract for ComposerEditor.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Retained the parent composer surface geometry through Pretty’s equivalent centralized style constants.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Adopts the parent ComposerToolbarScroller usage that no longer supplies explicit fadeOpaque and fadeTransparent props, retaining contentPaddingRight.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Added the parent's useUniwindTheme hook import for the native review-diff presentation.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Applied the parent's adaptive neutral background token to assistant attachment images.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Applied the parent's adaptive neutral muted-text token to the retained Pretty Thinking indicator.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — Preserved parent attachment loading behavior by carrying the attachment ID through Pretty's structured image descriptor rather than the parent's direct prop shape.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Migrated thread-settings sheet color lookup to useUniwindTheme while retaining the same Pretty theme tokens.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Integrated the parent serverEnvironment.refreshProviders command through useAtomCommand.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Integrated environment-scoped provider/model catalog refresh into ThreadSettingsCatalogScreen, including disabling concurrent refreshes and refreshes without an environment.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Integrated the parent provider-catalog refresh runner and user-visible error alert behavior around the fork's catalog UI.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — Placed the parent refresh behavior in the fork-refactored catalog component rather than accepting the mechanically misaligned code inside useCommitThreadSettings.
- `apps/mobile/src/features/threads/git/GitOverviewSheet.tsx` — Adopted `useUniwindTheme()` as the first-party theme source for foreground and sheet colors.
- `apps/mobile/src/features/threads/git/GitOverviewSheet.tsx` — Removed the obsolete per-color `useThemeColor` calls and unnecessary string coercion at this conflict boundary.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Added the upstream ServerProvider contract type alongside the fork's skill types.
- `apps/mobile/src/features/threads/new-task-flow-provider.tsx` — Adopted the upstream selectedProviderStatus name for the memoized selected provider record.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Status text now uses the parent's adaptive light/dark color utility classes, including an equivalent adaptive class for Pretty's Monitoring status.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Snoozed shelf count styling now uses the parent's adaptive blue utility.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Theme token reads in shelf headers, pending rows, and thread rows now use the parent's useUniwindTheme API, extended to Pretty-specific chrome and pin tokens.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — The parent's class-based SymbolView muted tint is applied to the settled chevron through Pretty's shared shelf-header component.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Upstream's `text-adaptive-blue-600-400` utility now styles snoozed-row timestamp text in place of separate light and dark blue classes.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Removed the obsolete useThemeColor import and unused pressedBackground lookup.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Adopted the parent adaptive emerald color token for the Copied indicator.
- `apps/mobile/src/lib/mobileTheme.test.ts` — Removed the obsolete MOBILE_THEME_IDS test import in line with upstream's built-in-theme test/API cleanup.
- `apps/mobile/src/lib/mobileTheme.test.ts` — Adopted upstream's readDefaultMobileThemeVariables test-support abstraction for validating static stylesheet values.
- `apps/mobile/src/lib/mobileTheme.test.ts` — Preserved upstream's explicit static checks for light screen, dark screen, and skill-foreground defaults, with expectations adapted to the fork palette.
- `apps/mobile/src/lib/mobileTheme.test.ts` — Reworked the nearby stylesheet lockstep test to use the upstream helper and avoid stale NodeFS and DEFAULT_MOBILE_THEME_VARIABLES references.
- `apps/mobile/src/lib/modelOptions.test.ts` — Integrated the parent test verifying new-task model selection precedence: draft selection, then project default, then sticky selection, then provider default.
- `apps/mobile/src/lib/modelOptions.test.ts` — Integrated the upstream ModelOption type import needed to represent and test the provider-default fallback.
- `apps/mobile/src/native/T3ComposerEditor.ios.tsx` — Integrated the parent refactor to obtain composer colors from one `useUniwindTheme()` snapshot.
- `apps/mobile/src/native/T3ComposerEditor.ios.tsx` — Integrated direct Uniwind theme-token values in the native editor's serialized theme payload.
- `apps/mobile/src/native/T3ComposerEditor.native.tsx` — Replaced multiple `useThemeColor` calls with the parent’s single `useUniwindTheme()` lookup.
- `apps/mobile/src/native/T3ComposerEditor.native.tsx` — Updated native composer theme serialization to consume the consolidated theme object directly for text, placeholder, chip, skill, and file-icon colors.
- `apps/mobile/src/state/use-composer-drafts.test.ts` — Adopted the upstream test description clarifying that sending a new task drops both draft-local model and workspace selections.
- `apps/mobile/src/state/use-composer-drafts.ts` — Persisted composer state now decodes, loads, writes, schedules, and flushes sticky model selection together with drafts.
- `apps/mobile/src/state/use-composer-drafts.ts` — Stale model-only new-task drafts are repaired so model precedence can resolve project, sticky, and provider defaults again.
- `apps/mobile/src/state/use-composer-drafts.ts` — Native-share importedShareIds receipts survive decode, bounded encoding, and attachment rehydration, preventing duplicate imports after restart.
- `apps/mobile/src/state/use-composer-drafts.ts` — Debounced persistence enters the serialized queue before hydration completes, so a flush cannot drain ahead of a pending state write.
- `apps/mobile/src/state/use-composer-drafts.ts` — The persistence scheduler uses the upstream state-oriented name and snapshots both draft and sticky-model atoms.
- `apps/mobile/src/state/use-composer-drafts.ts` — Flush waits for hydration before writing and drains already-fired queued persistence work.
- `apps/mobile/src/state/use-composer-drafts.ts` — Composer hydration now uses the parent's combined persisted-state format, including persisted drafts and sticky model selection.
- `apps/mobile/src/state/use-composer-drafts.ts` — Persisted sticky model selection is restored only when no newer in-memory selection exists.
- `apps/mobile/src/state/use-composer-drafts.ts` — Draft mutations use the parent's unified composer-state persistence scheduler, and the new sticky model setter persists through the same path.
- `apps/mobile/src/state/use-composer-drafts.ts` — Content clearing explicitly extracts and conditionally preserves the parent model selection according to clearModelSelection.
- `apps/mobile/src/state/use-composer-drafts.ts` — Atomic share-import persistence now writes both drafts and sticky model selection through writePersistedComposerState.
- `apps/server/src/auth/dpop.test.ts` — Imported mapDpopFailureReason from the parent DPoP module.
- `apps/server/src/auth/dpop.test.ts` — Added the parent's complete test matrix for converting verifier failure codes into safe client-facing categories, including request, token, timing, key, and invalid-proof mappings.
- `apps/server/src/auth/dpop.ts` — Added the parent's mapping from shared DPoP verification failure codes to contract-level DPoP failure reasons.
- `apps/server/src/auth/dpop.ts` — Added span annotation for replayed-proof failures using environment.dpop.failure_code before returning the mapped invalid-credential error.
- `apps/server/src/auth/dpop.ts` — Preserved the parent's distinction between replay errors and internal replay-store errors when adding telemetry.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.test.ts` — Integrated upstream regression coverage ensuring that re-creating a deleted thread ID clears stale messages, activities, sessions, turns, proposed plans, pending approvals, shell flags, and thread-detail state.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — On `thread.created`, stale message projections for a reused soft-deleted thread ID are removed before replay rebuilds the new incarnation.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — On `thread.created`, stale proposed-plan projections are removed for the recreated thread ID.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — On `thread.created`, stale activity projections are removed for the recreated thread ID.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — On `thread.created`, stale session projections are removed for the recreated thread ID.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — On `thread.created`, stale turn projections are removed for the recreated thread ID.
- `apps/server/src/orchestration/Layers/ThreadDeletionReactor.test.ts` — Integrated the parent contract identifiers and service/layer imports needed to construct full orchestration events and exercise the live reactor.
- `apps/server/src/orchestration/Layers/ThreadDeletionReactor.test.ts` — Integrated the parent `ThreadDeletionReactor` drain regression test proving `drainThrough` waits for a committed and published deletion that has not yet reached the subscriber.
- `apps/server/src/orchestration/Layers/ThreadDeletionReactor.test.ts` — Integrated the parent Effect Fiber, Layer, Ref, and Stream test infrastructure without displacing the fork cleanup coverage.
- `apps/server/src/provider/opencodeRuntime.inventory.test.ts` — Added the parent regression test proving that an agents-endpoint failure does not discard provider inventory and yields empty agent and skill inventories.
- `apps/server/src/provider/opencodeRuntime.inventory.test.ts` — Retained the parent inventory suite covering skill-discovery failure isolation, SDK skill metadata filtering, oversized CLI skill output, and capped command output.
- `apps/server/src/provider/opencodeRuntime.permissions.test.ts` — Restored OpenCode permission-rule regression coverage rather than treating deletion of the test alone as evidence that the provider feature was removed.
- `apps/server/src/provider/opencodeRuntime.permissions.test.ts` — Updated full-access coverage to require an explicit allow rule for external_directory in addition to the wildcard allow rule.
- `apps/server/src/server.test.ts` — Added the DpopFailureReason contract type import required by upstream DPoP test coverage.
- `apps/server/src/server.test.ts` — Added upstream coverage ensuring every subscribeServerConfig connection independently refreshes the provider registry, including consecutive websocket connections.
- `apps/server/src/ws.ts` — Imported and acquired the parent ThreadDeletionReactor service.
- `apps/server/src/ws.ts` — After a genuinely successful bootstrap thread creation, the resolution drains deletion processing through the returned creation sequence before setup scripts, terminals, provider sessions, or the first turn can use the reused thread ID.
- `apps/server/src/ws.ts` — Added environmentThemesUpdated events sourced from the environment-theme stream, gated by the client's environmentThemes capability so older clients do not fail decoding unknown events.
- `apps/server/src/ws.ts` — Merged environment-theme updates into the server-config live event stream while retaining the parent's no-duplicate-snapshot behavior.
- `apps/web/src/browser/ElectronBrowserHost.tsx` — Integrated the parent change that destructures each session's pictureInPicture state and passes it to HostedBrowserWebview.
- `apps/web/src/cloud/linkEnvironment.ts` — Integrated the parent's `relayProtectedErrorMessage` import alongside `ManagedRelay` for the upstream protected-relay error handling.
- `apps/web/src/components/ChatMarkdown.tsx` — Integrated imageBaseDir into the markdown component memoization dependencies so upstream relative/local image resolution updates correctly.
- `apps/web/src/components/ChatMarkdown.tsx` — Retained the parent's fileLinkParentSuffixByPath and inlineCodeFileLinkMetaByText dependencies for file-link metadata and inline-code file-link rendering.
- `apps/web/src/components/ChatView.tsx` — The image-specific bootstrap prompt is generalized to cover any attached files.
- `apps/web/src/components/ChatView.tsx` — Server-advertised file attachment limits are read and clamped before use.
- `apps/web/src/components/ChatView.tsx` — Plan follow-up eligibility now uses the shared helper and suppresses the prompt while the composer has attachments.
- `apps/web/src/components/ChatView.tsx` — Direct annotation screenshots are deduplicated against composer images and are appended only when the provider turn attachment cap permits it.
- `apps/web/src/components/ChatView.tsx` — Nullable direct-annotation images are normalized so screenshot metadata is only claimed when a real image is already attached or can actually be appended.
- `apps/web/src/components/ChatView.tsx` — First-message thread titles fall back to the first attached file name when there is no text or image name; this behavior is adapted to the fork's outgoing attachment snapshot.
- `apps/web/src/components/ChatView.tsx` — The scroll-to-end pill now uses scrollToEndClearance so its position accounts for the parent's updated clearance calculation.
- `apps/web/src/components/ChatView.tsx` — Draft hero headline padding contracts when a composer shoulder tab is present.
- `apps/web/src/components/ChatView.tsx` — ChatComposer now receives maxFileAttachmentBytes so the parent's file attachment size limit is enforced.
- `apps/web/src/components/Sidebar.tsx` — Imported and used the parent's `filterSidebarProjectScopeItems` helper.
- `apps/web/src/components/Sidebar.tsx` — Integrated the parent's `{value, label}` project-scope item collection, scope-key lookup map, and selected-item derivation.
- `apps/web/src/components/Sidebar.tsx` — Integrated the reducer-driven project-scope menu open/query state in place of the obsolete standalone `projectScopeMenuOpen` boolean.
- `apps/web/src/components/Sidebar.tsx` — Integrated Base UI combobox filtering, including synchronized query filtering, conditional scope reset behavior, auto-highlight ordering safeguards, and empty-state support.
- `apps/web/src/components/chat/ChatComposer.tsx` — Added FileIcon and PaperclipIcon imports for the parent file-attachment UI.
- `apps/web/src/components/chat/ChatComposer.tsx` — Added and destructured maxFileAttachmentBytes for upstream attachment-size enforcement.
- `apps/web/src/components/chat/ChatComposer.tsx` — Composer file attachments now make the draft sendable and invalidate the memo when their count changes.
- `apps/web/src/components/chat/ChatComposer.tsx` — Stash snapshot keys now include type-prefixed composer image and file attachment IDs, preventing duplicate stashes from ignoring file changes or colliding across attachment types.
- `apps/web/src/components/chat/ChatComposer.tsx` — Accepted non-image file attachments are added to the composer draft through addComposerFilesToDraft.
- `apps/web/src/components/chat/ChatComposer.tsx` — Files-only batches return after staging, while mixed batches proceed to image compression only when accepted images exist.
- `apps/web/src/components/chat/ChatComposer.tsx` — The pending compression counter now reserves acceptedImages.length rather than the unrelated acceptedFiles.length, matching the finally-block decrement.
- `apps/web/src/components/chat/ChatComposer.tsx` — The composer API dependency is updated from addComposerImages to the unified addComposerAttachments callback used by dropped files.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Added FileIcon support for file and unknown-attachment rows.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Rendered user file attachments with direct preview-URL downloads when available.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Preserved non-downloadable files as inert rows and routed other downloads through ctx.onFileDownload.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Rendered open-union attachment types that are neither images nor files as inert, named rows.
- `apps/web/src/components/preview/PreviewAutomationHosts.tsx` — Desktop overlay readiness is queried only while the target preview webview is actively rendering.
- `apps/web/src/components/preview/PreviewAutomationHosts.tsx` — A browser-surface activity lease is acquired before automation operations wait for a target overlay, keeping the runtime render-active.
- `apps/web/src/components/preview/PreviewAutomationHosts.tsx` — Overlay-dependent open operations also acquire the browser-surface activity lease before readiness polling.
- `apps/web/src/components/preview/PreviewAutomationHosts.tsx` — The browser-surface activity lease is released when each request settles, alongside the fork's guest residency lease.
- `apps/web/src/components/settings/KeybindingsSettings.tsx` — Generalized WarningTooltipIcon content so unknown-condition and keybinding-conflict warnings display their own correct explanations.
- `apps/web/src/components/settings/KeybindingsSettings.tsx` — Componentized existing-binding editing into reusable shortcut, when-clause, menu, source-badge, hover-menu, title, and SettingsRow controls.
- `apps/web/src/components/settings/KeybindingsSettings.tsx` — Added an explicit validated Save action for changed bindings and retained recording state, conflict detection, and improved shortcut accessibility labels.
- `apps/web/src/components/settings/KeybindingsSettings.tsx` — Integrated the modular new-keybinding form with dedicated command, shortcut, condition, cancel, conflict-warning, and save controls.
- `apps/web/src/components/settings/KeybindingsSettings.tsx` — Integrated the reusable KeybindingsList and SettingsRow-based layout, including add-row handling and the empty search state.
- `apps/web/src/components/settings/KeybindingsSettings.tsx` — Integrated the extracted BrowserKeybindingNotice component for browser builds.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — The parent's compact ArrowUpCircleIcon update-advisory trigger is adopted.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — The parent's coherent popover-based update details, update action, manual-command display, and copy-command interaction remain in place.
- `apps/web/src/composerDraftStore.ts` — Imported ChatFileAttachment so composer drafts can represent the parent's generalized file attachments alongside images.
- `apps/web/src/composerDraftStore.ts` — Adopted the parent's attachment-oriented prompt-stash documentation rather than describing the operation as image-only.
- `apps/web/src/composerDraftStore.ts` — When moving composer content, images that exceed destination capacity remain in the source draft instead of being discarded.
- `apps/web/src/composerDraftStore.ts` — Files that cannot be transferred, including environment-bound uploads, remain in the source draft.
- `apps/web/src/composerDraftStore.ts` — Non-persisted image IDs and persisted attachment metadata are now removed from the source only for images that actually moved.
- `apps/web/src/hooks/useHandleNewThread.ts` — Imported the parent’s `resolveNewThreadModelSelectionOverride` helper used by the already-merged destination-draft logic.
- `apps/web/src/hooks/useHandleNewThread.ts` — Integrated the parent precedence rule that a target project’s configured model selection wins over a carried model.
- `apps/web/src/hooks/useHandleNewThread.ts` — Integrated the parent clarification that runtime and interaction modes carry independently from model selection.
- `apps/web/src/hooks/useTheme.ts` — Integrated the parent's structured applyTheme options API instead of retaining positional control arguments.
- `apps/web/src/hooks/useTheme.ts` — Integrated preservePreview with its parent default of true, so ordinary synchronization does not overwrite an active theme-editor preview.
- `apps/web/src/hooks/useTheme.ts` — Retained the parent's explicit refresh behavior, which can set preservePreview to false, and its forced hard-cut behavior for cross-tab storage synchronization and refreshes.
- `apps/web/src/hooks/useTheme.ts` — Adapted T3 Pretty's source-aware transition control into the parent options API without changing the parent's preview behavior.
- `apps/web/src/hooks/useThreadActions.ts` — Added the confirmThreadUnpin client-setting subscription required by the parent's thread-unpin confirmation behavior.
- `apps/web/src/promptStashStore.test.ts` — Integrated the parent EnvironmentId import needed by upstream environment-aware prompt-stash tests.
- `apps/web/src/promptStashStore.ts` — Integrated PersistedComposerFileAttachment from the parent composer draft store for the stash entry's optional signed-upload file references.
- `apps/web/src/routes/__root.tsx` — Integrated the parent default-theme adoption hook import.
- `apps/web/src/routes/__root.tsx` — Integrated the parent environment-theme synchronization hook import.
- `docs/internals/glossary.md` — Integrated the parent glossary links to `apps/server/src/environmentTheme.ts` and `docs/user/environment-theme.md`.
- `docs/internals/glossary.md` — Updated the parent's Environment theme glossary entry to use the newly allocated reference identifiers while retaining its documentation behavior and content.
- `docs/internals/providers.md` — Restored the parent OpenCode driver reference required by the surrounding OpenCode provider documentation.
- `docs/internals/providers.md` — Added the parent OpenCodeServerOwner reference for the new shared helper ownership and lifecycle documentation.
- `docs/user/composer.md` — Documented mobile OpenCode model rows showing their upstream provider and allowing searches by provider name in both new and existing threads.
- `docs/user/composer.md` — Documented prompt stashing with the default platform shortcuts, attachment upload completion requirement, stash restoration menu, environment affinity for uploaded files, the 24-hour server retention period, and the Attach again recovery flow.
- `docs/user/mobile-appearance.md` — Documented system glass material for new-task and thread composers on supported iOS versions, with themed backgrounds on other platforms.
- `docs/user/mobile-appearance.md` — Documented applying a personalization card to both light and dark appearances and using preview circles to configure either appearance independently.
- `infra/relay/src/auth/DpopProofs.verifyAndConsume.test.ts` — Integrated the parent test confirming that a correctly signed DPoP proof older than the allowed 300-second window is rejected with `DpopProofRejected` and code `time_window`, without attempting replay persistence.
- `infra/relay/src/http/Api.test.ts` — Integrated the parent `relayDpopFailureReason` import required by the new safe client-facing DPoP failure-category tests.
- `packages/client-runtime/src/authorization/layer.test.ts` — Integrated the parent test asserting that a generic DPoP authentication rejection includes DPOP_UNKNOWN_HINT, presenting clock skew as a possible cause while preserving the authentication reason and trace ID.
- `packages/client-runtime/src/relay/managedRelayState.test.ts` — Integrated RelayAuthInvalidError from the parent relay contracts for upstream invalid-authentication error handling and test coverage.
- `packages/client-runtime/src/relay/managedRelayState.test.ts` — Adopted the parent's inline type import organization for relay client records and status responses.
- `packages/client-runtime/src/relay/managedRelayState.ts` — Integrated specialized handling for ManagedRelayRequestFailedError values with relay errors, using relayProtectedErrorMessage to expose the appropriate protected relay error message.
- `packages/client-runtime/src/state/pullRequests.test.ts` — Integrated the parent regression test proving that a successful pull-request comment update refreshes the mounted activity atom and exposes the updated comment body.
- `packages/client-runtime/src/state/pullRequests.test.ts` — Integrated the parent's realistic WebSocket RPC session, environment supervisor, environment registry, atom registry lifecycle, query execution, and diff-loader test setup required by the new test.
- `packages/client-runtime/src/state/pullRequests.test.ts` — Integrated the WS_METHODS-based pull-request activity and update-comment mocks and AsyncResult success assertions.
- `packages/client-runtime/src/state/pullRequests.ts` — Integrated the parent's shared `activity` atom-family binding instead of constructing a separate family in the returned object, allowing mutation callbacks such as `updateComment` to refresh the same family exposed to consumers.
- `packages/client-runtime/src/state/server.test.ts` — Added the upstream `environmentThemes: true` capability required for capability-driven version-skew projection behavior.
- `packages/client-runtime/src/state/server.test.ts` — Preserved the upstream explanatory comment, adapted to identify the specific capability and placed beside the canonical capabilities object.
- `packages/client-runtime/src/state/server.ts` — Integrated upstream's `environmentThemes` subscription option for surfaces that explicitly opt in.
- `packages/client-runtime/src/state/server.ts` — Ensured the environment-theme request remains present even if obtaining the session's initial configuration snapshot fails.
- `packages/client-runtime/src/state/server.ts` — Kept non-opted-in surfaces on an empty theme request, preserving upstream's conditional payload behavior.
- `packages/contracts/src/baseSchemas.ts` — Integrated DpopFailureReason with all upstream failure categories and its documentation, exposing safe DPoP failure classes without proof or authentication details.
- `packages/contracts/src/environmentHttp.ts` — EnvironmentAuthInvalidError now accepts the parent's optional DpopFailureReason field, retaining compatibility with older servers that omit the field.
- `packages/contracts/src/environmentHttp.ts` — The DpopFailureReason schema is imported from baseSchemas.ts for the new authentication error field.
- `packages/contracts/src/relay.ts` — Imported the parent's shared DpopFailureReason schema and continued exposing it through RelayDpopFailureReason.
- `packages/contracts/src/relay.ts` — Added the optional dpopFailureReason field to RelayAuthInvalidError, including compatibility with older relays that omit the category.
- `packages/contracts/src/rpc.ts` — Added the optional `environmentThemes` capability flag so compatible clients can opt into `environmentThemesUpdated` stream events without breaking already-shipped clients.
- `packages/contracts/src/rpc.ts` — Preserved upstream's compatibility documentation explaining capability-gated theme events and old client/server behavior.
- `packages/contracts/src/settings.ts` — Integrated the parent confirmThreadUnpin client setting with its false decoding default.
- `packages/effect-codex-app-server/src/protocol.ts` — The parent's intent to eliminate the base implementation's repeated `current + chunk` and whole-buffer `split` path is retained by passing each incoming chunk directly to the dedicated incremental wire-line framer.
- `packages/effect-codex-app-server/src/protocol.ts` — Completed lines continue to be dispatched as chunks arrive, and a final unterminated line continues to be processed when stdin ends, through `wireLineFramer.push` and `wireLineFramer.finish` respectively.
- `patches/expo-modules-jsi@56.0.10.patch` — Accepted the Expo SDK 57 dependency migration, including deletion of the obsolete expo-modules-jsi@56.0.10 patch.
- `patches/expo-modules-jsi@56.0.10.patch` — Accepted the SDK 57 first-party replacement boundary rather than retaining a patch that the parent dependency graph no longer references.
- `patches/expo-modules-jsi@56.0.10.patch` — followed the parent nightly's deletion of this file
- `scripts/build-desktop-artifact.test.ts` — The WSL runtime archive and SHA-256 digest are asserted to be excluded from app.asar because they ship through extraResources.
- `scripts/build-desktop-artifact.test.ts` — Tests now cover WSL archive resource names, conditional bundling based on Linux node-pty availability, and production-runtime tar exclusions.
- `scripts/build-desktop-artifact.test.ts` — Windows archive handling is covered for CRLF member listings and colon-free relative tar targets, including correct archive placement and SHA-256 digest generation.
- `scripts/build-desktop-artifact.test.ts` — WSL runtime contents are verified to retain required Linux server/native dependencies while excluding Darwin, Windows, build-tree, package-manager, shim, and Claude SDK artifacts.
- `scripts/build-desktop-artifact.ts` — The generated WSL runtime archive and its SHA-256 file are excluded from app.asar because they are delivered through conditional extraResources.
- `scripts/build-desktop-artifact.ts` — The build configuration now conditionally includes WSL runtime resources only when a compatible Linux node-pty prebuild was bundled.
- `scripts/build-desktop-artifact.ts` — The WSL runtime availability is computed with bundlesWslRuntime from the target architecture and configured prebuild path.
- `scripts/build-desktop-artifact.ts` — Direct callers using the parent's WSL-only trailing boolean call shape remain compatible.

## Parent changes intentionally omitted

- `apps/server/src/provider/Drivers/OpenCodeDriver.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/server/src/provider/Layers/OpenCodeAdapter.test.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/server/src/provider/Layers/OpenCodeAdapter.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/server/src/provider/Layers/OpenCodeProvider.test.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/server/src/provider/Layers/OpenCodeProvider.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/server/src/provider/opencodeRuntime.environment.test.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/server/src/provider/opencodeRuntime.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/server/src/textGeneration/OpenCodeTextGeneration.test.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/server/src/textGeneration/OpenCodeTextGeneration.ts` — the parent nightly's changes to this retired OpenCode file. Reason: resurrecting it would restore the provider T3 Pretty intentionally removed
- `apps/desktop/src/preview/Manager.ts` — The parent's inline capturePage, image measurement, and JPEG encoding body inside deliverPreviewFrame.. Reason: Pretty already supplies a frame to this function through its screencast-first producer with a capturePage fallback. Retaining the parent body would shadow the function's wc/frame parameters, recapture every frame, duplicate encoding work on the main path, and regress Pretty's established preview performance architecture. The parent's lifecycle checks and delivery behavior were integrated around the existing produced frame instead.
- `apps/desktop/src/preview/Manager.ts` — The parent's Buffer representation for lastPictureInPictureFrame.. Reason: Pretty's screencast pipeline already carries the JPEG as a base64 frame payload. Caching and comparing that one-to-one encoded payload provides the same exact-frame deduplication semantics without decoding every hot-path frame back into a Buffer.
- `apps/mobile/generated-uniwind-default-theme-variables.json` — The parent artifact's stock light screen and sheet values (`#f2f2f7` and matching gray sheet tokens).. Reason: Those literals would replace T3 Pretty's authoritative World Scenery light surfaces; only the parent's JSON representation is adopted.
- `apps/mobile/generated-uniwind-default-theme-variables.json` — The parent artifact's stock light message and chrome values for `--color-md-user-fence-text`, `--color-md-hr`, all user-bubble tokens, backdrop, drawer, drawer shadow, dot separator, wordmark, and chevron.. Reason: They would regress the fork's pastel-sage user bubble and World Scenery light presentation back to the stock blue/neutral palette.
- `apps/mobile/generated-uniwind-default-theme-variables.json` — The parent artifact's stock neutral dark values for screen, sheets, cards, foreground hierarchy, borders, separators, and subtle states.. Reason: They conflict with T3 Pretty's authoritative green-tinted World Scenery dark theme.
- `apps/mobile/generated-uniwind-default-theme-variables.json` — The parent artifact's stock dark dot-separator, wordmark, and chevron values.. Reason: They would replace T3 Pretty's coordinated World Scenery dark chrome with neutral white values.
- `apps/mobile/src/components/AndroidAnchoredMenu.tsx` — Replace the themed native Android ripple with the generic active:bg-subtle pressed-state class and completely remove ripple color resolution.. Reason: This would change T3 Pretty's intentional platform-specific Android interaction styling. The fork's visual-design behavior is authoritative, while the compatible upstream SymbolView color API was integrated separately.
- `apps/mobile/src/components/CompactBrandTitle.tsx` — Apply colorClassName="accent-icon" to T3Wordmark.. Reason: The fork intentionally uses its generated T3 Pretty mark without a parent color override; applying accent-icon could regress the reviewed Pretty lockup presentation.
- `apps/mobile/src/components/CompactBrandTitle.tsx` — Pass an undefined allowFontScaling value through unchanged when callers omit the prop.. Reason: T3 Pretty explicitly defaults this value to true to protect Android font scaling and accessibility behavior.
- `apps/mobile/src/components/ComposerToolbar.tsx` — Treat props.disabled as sufficient to apply subtle primary icon tint and reduced opacity even while loading.. Reason: T3 Pretty intentionally distinguishes in-flight loading from ordinary disabled chrome so an active send remains visually primary and undimmed.
- `apps/mobile/src/components/ComposerToolbar.tsx` — Render icon nodes and symbols directly without the ComposerSendIconSlot loading path.. Reason: That would remove the fork's send spinner and stable icon-slot behavior used by standard queue/steer delivery.
- `apps/mobile/src/components/ComposerToolbar.tsx` — Show the menu chevron during loading whenever showChevron is not false.. Reason: T3 Pretty suppresses the chevron while the spinner is active to keep the in-flight send state unambiguous.
- `apps/mobile/src/components/ComposerToolbar.tsx` — Use class-token tinting exclusively with no resolved native color at this boundary.. Reason: The parent class-token API is used for SymbolView, but the fork's native loading indicator still requires a concrete primary-foreground color value.
- `apps/mobile/src/components/T3Wordmark.tsx` — Replacing the T3 Pretty bitmap with the parent's inline SVG path and its 94.3941/56.96 SVG aspect ratio.. Reason: This would remove the fork's approved lockup artwork and use geometry and dimensions belonging to the parent brand; the bitmap and its native ratio are authoritative fork identity.
- `apps/mobile/src/components/T3Wordmark.tsx` — Using `withUniwind(Path)`, `currentColor`, `color`, and `colorClassName` to recolor the rendered mark at runtime.. Reason: Runtime recoloring would weaken the approved fixed-sage T3 Pretty presentation. The props remain accepted for parent call-site compatibility, but intentionally do not override the branded raster artwork.
- `apps/mobile/src/features/home/HomeHeader.tsx` — The parent's Android T3 Code wordmark with an app-variant stage badge, including resolveMobileStageLabel and the updated T3Wordmark colorClassName API at this brand slot.. Reason: Rendering that lockup would overwrite T3 Pretty's authoritative generated CompactBrandTitle and restore parent branding. The parent styling refactor is inapplicable because the fork-owned component encapsulates this presentation.
- `apps/mobile/src/features/home/WorkspaceConnectionTitle.tsx` — The parent's in-flow, status-only top-level StatusFadeIn rendering structure was not adopted verbatim.. Reason: That structure would replace/remount the persistent brand slot and regress T3 Pretty's reconnect fix, which keeps CompactBrandTitle mounted inside RNSScreenStackHeaderSubview. The parent's new max-width, shrinking, offset, and color-token behaviors are instead composed into the fork's absolute overlay.
- `apps/mobile/src/features/settings/appearance/sections/ThemeAppearanceSection.tsx` — The parent's generic PreviewOrb and ThemeCard implementation, including SVG radial-gradient orbs, previewPercentage helper, MOBILE_THEME_OPTIONS wiring, per-appearance selected accessibility state, press scaling, and class-based selection-badge theming.. Reason: T3 Pretty deleted this generic card path and replaced the surrounding appearance experience with fork-specific Boring and World Scenery controls. Reintroducing the unused parent components and imports would duplicate or regress the fork's authoritative selector rather than compose with it.
- `apps/mobile/src/features/threads/GitActionProgressOverlay.tsx` — Import and use tryOpenExternalUrl for pull-request URLs.. Reason: The parent's external-browser behavior conflicts with T3 Pretty's established native pull-request manager. THEIRS does not introduce a first-party native replacement, so the fork-native behavior remains authoritative.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The parent hunk's post-RPC-success placement of pending-task and draft cleanup.. Reason: T3 Pretty intentionally performs that cleanup during the optimistic handoff before immediate thread navigation and has a rejected-start fallback queue path. Repeating the parent block after success would duplicate outbox removal or draft clearing; only its new model-selection reset is relocated and integrated.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The parent cleanup that removes the project-underline theme state.. Reason: T3 Pretty's project selector still uses the muted underline as part of its fork-specific mobile visual design, so the token is retained through the new Uniwind API.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The parent cleanup that removes the dark-mode presentation state from this screen.. Reason: T3 Pretty's World Scenery presentation still requires dark-mode contrast handling, so a narrowly scoped scenery color-scheme value is retained.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Unconditionally apply the parent's fixed `bg-sheet` dock and `fadeSurface="sheet"` presentation, with raw workspace controls, while World Scenery is active.. Reason: That presentation would cover T3 Pretty's World Scenery and regress its transparent dock, glass controls, and photo-aware fade treatment. The parent sheet presentation is retained for normal non-scenery mode.
- `apps/mobile/src/features/threads/NewTaskRouteScreen.tsx` — The parent hunk's legacy inline projectScopes.map renderer, including its change from tintColor={chevronColor} to tintColorClassName={"accent-chevron"}.. Reason: That node was removed by T3 Pretty's LegendList refactor and its rendering responsibility moved to renderProjectScope. Restoring the parent block here would place a non-virtualized inline renderer inside ListEmptyComponent, close the wrong component (ScrollView instead of LegendList), regress recycling/performance, and override the fork-owned row rendering and visual theming path.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Removal of the direct composer-trigger, search-ranking, path-search, slash-skill, and ComposerCommandItem dependencies after extracting the parent command-menu hook.. Reason: Pretty's fork-only app/skill/path command and mention extensions still rely on these utilities around the parent hook; deleting them would risk regressing those extensions.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — The parent's retained direct React Native Image dependency and removal of StyleSheet from the composer imports.. Reason: Pretty replaced direct attachment image rendering with its ComposerAttachmentThumb presentation and retains fork-specific composer styling.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Removal of useAppearancePreferences and the ComposerSurface isDarkMode input.. Reason: Pretty's Reduce Transparency accessibility path requires the resolved light/dark appearance to render the correct fully opaque surface and border.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Replacement of the theme-token shadow with shadow-adaptive-black-a15-a35 and the associated pre-Android-9-only elevation fallback.. Reason: The parent shadow hard-codes an adaptive black treatment and would bypass Pretty's --color-primary-shadow theme token, weakening fork themes and World Scenery presentation. The existing elevation must remain paired with that themed legacy shadow implementation.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — The parent's three-dot adaptive working indicator and its horizontal dot-and-label layout.. Reason: It directly conflicts with T3 Pretty's authoritative shimmering Thinking indicator, which includes focus cancellation, accessibility treatment, web parity, and reduced-motion behavior.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — The parent's visible “Working for {durationLabel}” live elapsed-time label.. Reason: T3 Pretty intentionally surfaces only Thinking while work is live and defers elapsed time to the completed turn fold; showing both would regress that fork-specific timeline UX.
- `apps/mobile/src/features/threads/ThreadNavigationSidebar.tsx` — Upstream removed the useThemeColor import.. Reason: T3 Pretty still requires this fork-specific theming hook for its mobile sidebar presentation, so applying the parent cleanup would regress or break fork theming.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The parent picker contract and existing-thread wrapper omit initialPage and onActivePageChange.. Reason: Taking that shape would regress T3 Pretty's persisted catalog-page behavior and the recent fixes that keep the sheet page stable across navigation and live re-presentation.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The parent considers session.providerFilter a custom catalog filter for toolbar-icon presentation.. Reason: T3 Pretty's redesigned picker intentionally treats only showLegacy as the custom catalog filter; restoring the parent condition would change the fork's filter presentation semantics.
- `apps/mobile/src/features/threads/ThreadSettingsSheet.tsx` — The parent retains NewTaskThreadSettingsRouteScreen and adds flow.selectedEnvironmentId to its session provider.. Reason: T3 Pretty intentionally removed that nested New Task settings route as part of its one-panel picker architecture. Reintroducing the obsolete route solely to apply the environment prop would regress the fork UX; the associated useNewTaskFlow and resolveProviderOptionDescriptors imports are therefore also omitted.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — The adaptive blue divider utility from the parent's legacy snoozed-header markup was not added.. Reason: T3 Pretty intentionally replaced that divider-based header with a unified icon-and-count shelf header whose visual design has no divider element; adding one would regress the fork's shelf and World Scenery presentation.
- `apps/mobile/src/lib/mobileTheme.test.ts` — Upstream expectations that the default mobile palette uses #f2f2f7 for the light screen, #0a0a0a for the dark screen, and #f0abfc for the light skill foreground.. Reason: Those legacy parent colors directly conflict with T3 Pretty's authoritative World Scenery mobile default (#f4f6f4, #0e1110, and #27633f respectively). The upstream assertion method is retained, but its values must follow the fork theme.
- `apps/mobile/src/lib/mobileTheme.ts` — Remove the `DEFAULT_MOBILE_THEME_VARIABLES` import as done by the parent theme implementation.. Reason: That local module supplies T3 Pretty's branded World Scenery default mobile palette. Removing it would regress fork-specific theming rather than provide a behavior-compatible cleanup.
- `apps/mobile/src/lib/mobileTheme.ts` — Retain the parent-side `STANDARD_THEME_PREVIEW_COLORS` value import at this boundary.. Reason: T3 Pretty's current preview implementation no longer uses the generic standard-preview constant after its Pretty/Boring theme changes; restoring it would be an unused import and would not add compatible parent behavior.
- `apps/mobile/src/state/use-composer-drafts.ts` — Catch persisted draft open/read/decode failures, log them as ignored, and return an empty drafts/sticky-model state.. Reason: This conflicts with T3 Pretty's reliability contract: load failures must remain observable as ComposerDraftPersistenceError so callers do not treat unreadable state as an authoritative empty document or overwrite recoverable drafts.
- `apps/mobile/src/state/use-composer-drafts.ts` — Serialize the parent's direct nonEmptyDrafts record without Pretty's attachment-payload encoder.. Reason: T3 Pretty intentionally bounds draft-file growth by omitting image data URLs and rehydrating them from preview files. Parent filtering semantics, including imported-share receipt retention, were integrated into the bounded encoder instead.
- `apps/server/src/provider/Layers/ProviderRegistry.test.ts` — OpenCode test asserting that a successful refresh drops stale models absent from the refreshed inventory.. Reason: T3 Pretty removed the OpenCode provider, so retaining an OpenCode-specific registry contract would resurrect unsupported provider behavior.
- `apps/server/src/provider/Layers/ProviderRegistry.test.ts` — OpenCode test asserting that a failed refresh retains stale models, including the new parent assertions preserving slash commands and skills.. Reason: The behavior is exclusively for the removed OpenCode provider and has no compatible target in T3 Pretty's provider registry.
- `apps/server/src/provider/Layers/ProviderRegistry.test.ts` — OpenCode inventory-state test covering pending checks, logout, uninstall, reconnect, and failure after an authoritative refresh, including the new parent assertions that logout clears slash commands and skills.. Reason: These state transitions and assertions are OpenCode-specific; integrating them would regress the fork's deliberate removal of that provider.
- `apps/server/src/provider/Layers/ProviderRegistry.ts` — The parent-retained OpenCode probe-authoritativeness helper and provider-aware three-argument model merge call.. Reason: T3 Pretty intentionally removed the unused OpenCode provider and simplified mergeProviderModels to a two-argument generic merge. Restoring this OpenCode-specific path would reverse that fork change and would not match the current function signature.
- `apps/server/src/provider/Layers/ProviderRegistry.ts` — Retention of prior OpenCode slash commands and skills when a pending or failed probe emits empty metadata arrays.. Reason: This new behavior applies exclusively to the OpenCode provider, which T3 Pretty removed. Generalizing it to other drivers would be unsupported new behavior rather than a faithful integration.
- `apps/server/src/ws.ts` — Unconditionally dispatching bootstrap thread.create even when the thread ID already has an active compatible shell.. Reason: This would regress T3 Pretty's thread-transfer and duplicate-draft reliability behavior. The parent deletion fence is applied whenever this connection actually creates a new incarnation; an adopted existing thread has no new creation sequence to drain.
- `apps/server/src/ws.ts` — Always using bootstrap.createThread.title unchanged for native resume launches.. Reason: T3 Pretty's native provider-session resume flow requires NATIVE_RESUME_THREAD_TITLE; ordinary bootstrap launches still use the supplied parent title.
- `apps/server/src/ws.ts` — Reading settings updates directly from serverSettings.streamChanges at the mapping site.. Reason: The fork intentionally acquires serverSettings.subscribeChanges alongside keybinding and provider subscriptions before constructing the snapshot/live stream. The same redacted settings events are preserved through that pre-acquired stream.
- `apps/web/src/components/ChatView.tsx` — Restore the base-era workingStepLabel derivation for the in-chat working row.. Reason: OURS deliberately removed that status label as part of T3 Pretty's custom live/generated-headline and duplicate-thinking-indicator behavior. Restoring the unchanged parent context would regress the fork-specific chat presentation; the new attachment-aware plan-follow-up helper is integrated independently.
- `apps/web/src/components/Sidebar.tsx` — The parent's component-local `useState&lt;string | null&gt;` storage for `projectScopeKey`, which resets the selected scope on remount or reload.. Reason: This directly conflicts with T3 Pretty's established schema-validated local-storage persistence. Only the storage mechanism is omitted; the parent's new combobox and filtering behavior is retained around it.
- `apps/web/src/components/chat/ChatComposer.tsx` — Unconditionally call setThreadError(threadId, error), including passing null after successful validation.. Reason: Passing null can erase a newer or unread thread error from overlapping attachment work or a failed send; T3 Pretty's reliability fix intentionally reports only non-null failures.
- `apps/web/src/components/chat/ChatComposer.tsx` — Retain activeThread as the composer API memo dependency.. Reason: The merged callback reads activeThreadId directly. T3 Pretty intentionally uses that narrower identity dependency, avoiding unnecessary callback recreation when other active-thread fields change.
- `apps/web/src/components/settings/ProviderInstanceCard.tsx` — Unconditional update-loader spinning for users whose system requests reduced motion.. Reason: T3 Pretty's authoritative accessibility behavior requires motion-reduce:animate-none; the parent's normal animated loading behavior is otherwise preserved.
- `apps/web/src/components/settings/ThemeSettings.tsx` — Environment-published theme cards, including duplicate, whole-theme selection, single-appearance assignment, and custom-theme ID de-duplication.. Reason: The parent implementation depends on the generic ThemeLibraryCard/editor, customThemes, per-half assignment, and additional ThemeLibrary props that T3 Pretty deliberately removed when replacing this surface with its curated World Scenery/Boring personalization UI. Restoring only this hunk would not compile or preserve the fork's theme model.
- `apps/web/src/components/settings/ThemeSettings.tsx` — Reading raw stored light/dark theme halves before custom-theme removal so an environment theme that has not streamed in is not dropped.. Reason: T3 Pretty's replacement component has no custom-theme removal flow or theme-half mutation API at this boundary, so there is no corresponding operation to which the parent fix can be applied.
- `apps/web/src/components/settings/ThemeSettings.tsx` — Reading raw stored halves before converting a themed base into an explicit opposite-appearance half.. Reason: The fork-specific ThemeLibrary no longer implements the parent's automatic-mode theme-pair assignment flow; importing that fix alone would be unused, while restoring the whole flow would overwrite the authoritative Pretty personalization architecture.
- `apps/web/src/components/settings/ThemeSettings.tsx` — Parent custom-theme collection rendering and its edit, duplicate, download, remove, whole-theme selection, and per-appearance mixing controls from the conflicted hunks.. Reason: These controls belong to the generic theme-library implementation that OURS intentionally replaced. The conflicted parent block references removed components, stores, props, and handlers and cannot be composed into this file without a broad reintroduction that would displace the fork's curated theme UX.
- `apps/web/src/hooks/useHandleNewThread.ts` — The parent side retains the generic `useThread` entity-hook import.. Reason: This file in T3 Pretty deliberately uses `useThreadShell` for shell-only state and lower subscription overhead. The parent model-selection behavior is fully integrated without reverting that fork-specific architecture.
- `apps/web/src/hooks/useTheme.ts` — Force suppressTransitions for media-query-driven system appearance changes.. Reason: This would bypass T3 Pretty's system-sourced dusk/dawn sweep and the system-weather tempo used by its dissolve fallback.
- `apps/web/src/hooks/useTheme.ts` — Force suppressTransitions when setTheme applies a newly selected whole theme.. Reason: T3 Pretty intentionally animates explicit user theme selections through its custom theme-swap choreography.
- `apps/web/src/hooks/useTheme.ts` — Force suppressTransitions when setAppearanceMode applies a light, dark, or system mode selection.. Reason: This would regress T3 Pretty's animated appearance-mode transitions.
- `apps/web/src/hooks/useTheme.ts` — Force suppressTransitions when setThemeHalf changes an automatic-mode light or dark theme half.. Reason: T3 Pretty treats this as a user-driven visual theme change and intentionally animates it.
- `apps/web/src/hooks/useTheme.ts` — Force suppressTransitions when clearThemeHalves removes the automatic-mode mix.. Reason: This explicit user action must retain T3 Pretty's theme-swap animation rather than hard-cutting.
- `infra/relay/src/auth/DpopProofs.ts` — Removed the HttpApiError import.. Reason: The composed T3 Pretty implementation still uses HttpApiError.Unauthorized in DpopProofReplay.verify, so removing it would break type checking.
- `infra/relay/src/auth/DpopProofs.ts` — Omitted the parent side's absence of the sha256 import.. Reason: T3 Pretty's persistedReplayKey helper requires sha256 to bound oversized replay identifiers; dropping it would break compilation and regress relay persistence hardening.
- `packages/client-runtime/src/state/pullRequests.ts` — Use a 15-second stale time for pull-request activity without an idle TTL.. Reason: This would regress T3 Pretty's deliberate 20-second freshness window and idle cleanup for the large activity query, which reduce unnecessary host/API work and retained data.
- `packages/client-runtime/src/state/server.test.ts` — Use `settings: {}` and coerce the fixture with `as unknown as ServerConfig`.. Reason: This would regress the fork's complete default-settings fixture and remove compile-time ServerConfig validation. The upstream environment-themes behavior is integrated independently.
- `packages/contracts/src/relay.ts` — Use TrimmedNonEmptyString directly for RelayAuthInvalidError.traceId.. Reason: That would weaken T3 Pretty's hardened RelayTraceId length bound; the parent's DPoP addition is compatible with the stricter fork schema and was integrated independently.
- `packages/effect-codex-app-server/src/protocol.ts` — The parent's local `Array&lt;string&gt;` remainder declaration and `Stream.decodeText()` fragment-scanning implementation.. Reason: Copying this hunk would replace T3 Pretty's byte-bounded wire framer and bypass its `maximumWireLineBytes` overflow protection. Its incremental-processing intent is already fulfilled by the fork framer.
- `packages/effect-codex-app-server/src/protocol.ts` — The parent's EOF `remainder.join("")` and direct `handleLine` flush.. Reason: That flush cannot report framing overflow and duplicates buffering owned by the fork framer. `wireLineFramer.finish()` preserves the trailing-line behavior while retaining the hardened typed-error path.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.37-nightly.20260830.1226`
- Previously integrated parent nightly: `v0.0.37-nightly.20260829.1224`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/README.md` — T3 Pretty's public and internal Android variants remain on Google Play internal testing until the fork deliberately changes its release policy.
- `apps/mobile/README.md` — The fork-specific Play and EAS credential setup remains documented through `docs/operations/fork-mobile-release.md`.
- `apps/mobile/app.config.ts` — T3 Pretty Internal retains its branded microphone permission text for voice dictation.
- `apps/mobile/src/components/AppSymbol.tsx` — Preserved T3 Pretty’s IconClick fallback used by its additional mobile symbol mappings.
- `apps/mobile/src/components/AppSymbol.tsx` — Preserved T3 Pretty’s IconKey fallback for key-related mobile UI.
- `apps/mobile/src/components/AppSymbol.tsx` — Preserved T3 Pretty’s IconLayoutGrid choice for the square-grid symbol instead of reverting to the older IconApps visual.
- `apps/mobile/src/components/AppSymbol.tsx` — Preserved T3 Pretty’s IconUsers fallback for multi-person mobile UI.
- `apps/mobile/src/components/ControlPill.tsx` — T3 Pretty's token-driven ControlPill icon tinting remains connected through useThemeColor.
- `apps/mobile/src/components/ControlPill.tsx` — Disabled ControlPill menus still bypass both AnchoredMenu and MenuView hosts, preventing locked project selectors or other disabled controls from opening menus.
- `apps/mobile/src/components/ControlPill.tsx` — T3 Pretty's World Scenery menu architecture remains intact: tap menus continue through the token-styled AnchoredMenu path, while only iOS long-press context menus use MenuView.
- `apps/mobile/src/components/ControlPill.tsx` — The fork's no-tap-through intent for iOS context menus remains protected, now through the parent's native menu lifecycle coordination rather than the fork's 350 ms Pressability workaround.
- `apps/mobile/src/features/home/HomeRouteScreen.tsx` — Preserved T3 Pretty's `markThreadOpenStarted` call before opening a thread, retaining its immediate thread-loading/performance behavior.
- `apps/mobile/src/features/home/HomeRouteScreen.tsx` — Preserved the settled-thread behavior documented at this call site: opening a settled thread does not itself unsettle it.
- `apps/mobile/src/features/home/HomeScreen.tsx` — The thread-list clock does not continue ticking while the Home screen is covered or blurred, avoiding background timer work despite freezeOnBlur.
- `apps/mobile/src/features/home/HomeScreen.tsx` — The clock immediately re-synchronizes when the screen returns to focus, preserving correct inactivity auto-settle classification.
- `apps/mobile/src/features/home/HomeScreen.tsx` — No interval is created while Thread List V2 is disabled.

## Parent changes integrated at conflict boundaries

- `apps/mobile/README.md` — Preview and production variants use Expo fingerprinting to constrain OTA delivery to binaries with matching native dependencies, config plugins, and patches.
- `apps/mobile/README.md` — CI uses the `preview:dev` profile to reuse compatible native builds when possible.
- `apps/mobile/README.md` — The development variant defaults to `appVersion` to avoid recalculating fingerprints for Metro launch manifests.
- `apps/mobile/README.md` — `MOBILE_VERSION_POLICY` can override the default runtime-version policy.
- `apps/mobile/README.md` — Custom Release builds using the development identity must use fingerprint policy consistently for both builds and OTA updates.
- `apps/mobile/README.md` — Runtime-policy changes require native rebuilds for OTA matching, while existing development clients can continue loading local Metro bundles.
- `apps/mobile/app.config.ts` — Added the parent runtime-version policy override through MOBILE_VERSION_POLICY, with appVersion for development variants and fingerprint for other variants by default.
- `apps/mobile/src/components/AppSymbol.tsx` — Replaced the Tabler package-root import with individual icon-module imports so Metro does not eagerly register the entire Tabler icon set.
- `apps/mobile/src/components/AppSymbol.tsx` — Adopted the parent’s type-only imports for the Tabler Icon type and expo-symbols types, avoiding unnecessary runtime imports at this boundary.
- `apps/mobile/src/components/ControlPill.tsx` — Integrated the parent's typed PressableProps support for injected onTouchStart and onPress handlers.
- `apps/mobile/src/components/ControlPill.tsx` — Integrated the parent's menu preparation/open-state refs and pending-press storage.
- `apps/mobile/src/components/ControlPill.tsx` — Adopted the parent's first-party replacement for iOS context-menu tap-through handling, including physical-touch suppression, accessibility-click handling, preparation/display race handling, and correct release behavior when a native menu is cancelled or closed.
- `apps/mobile/src/features/home/HomeRouteScreen.tsx` — Integrated the parent's `handleSelectThread` callback so upstream thread-selection and navigation behavior remains centralized rather than duplicating the older direct navigation logic.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Replaced manual useEffect/isFocused timer management with the parent's useFocusEffect lifecycle, which starts or refreshes the clock on focus and cleans the interval up on blur.
- `apps/mobile/src/features/home/HomeScreen.tsx` — Adopted the parent's immediate refresh semantics for both feature enablement and screen focus.

## Parent changes intentionally omitted

- `apps/mobile/src/components/AppSymbol.tsx` — The parent side’s retained IconApps import.. Reason: The merged T3 Pretty symbol map uses IconLayoutGrid for the square-grid fallback and no longer references IconApps; retaining it would create an unused import without preserving any runtime behavior.
- `apps/mobile/src/components/ControlPill.tsx` — Retain View in the react-native import list.. Reason: The composed T3 Pretty implementation does not use View because non-native menu presentation remains delegated to AnchoredMenu. Keeping the unused import would add no behavior and could fail unused-import linting.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.37-nightly.20260830.1227`
- Previously integrated parent nightly: `v0.0.37-nightly.20260830.1226`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/providerUpdateDismissal.test.ts` — T3 Pretty's removal of the unused OpenCode provider is preserved: the obsolete test is deleted rather than restoring its former OpenCode-specific fixture.
- `apps/web/src/providerUpdateDismissal.test.ts` — No T3 Pretty runtime provider or notification behavior is changed by removing this test-only file.

## Parent changes integrated at conflict boundaries

- `apps/web/src/providerUpdateDismissal.test.ts` — Integrated the parent deletion from 2daff8c25, which removed this test after the providerUpdateDismissal helpers became unreachable and the implementation was updated.
- `apps/web/src/providerUpdateDismissal.test.ts` — followed the parent nightly's deletion of this file

## Parent changes intentionally omitted

- None. The resolver did not omit any parent change to protect T3 Pretty.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.38-nightly.20260831.1236`
- Previously integrated parent nightly: `v0.0.37-nightly.20260830.1227`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning
- 36 file(s) took the fork-side fallback because no model resolution was available; review their omissions below

## T3 Pretty changes preserved at conflict boundaries

- `pnpm-lock.yaml` — fork-only dependency entries are re-derived by lockfile regeneration against the merged package manifests
- `apps/desktop/src/preview/Manager.test.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/desktop/src/preview/Manager.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/package.json` — Preserved the expo-audio dependency required by T3 Pretty's host-routed mobile voice input/dictation behavior.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — The exported ComposerAttachmentPreview API remains available and retains the optional per-attachment preparing state used by T3 Pretty send-progress flows.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Global busy and per-attachment preparing states continue to dim thumbnails, suppress removal, and disable image preview while work is in progress.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Preparation overlays retain T3 Pretty's FadeIn/FadeOut timing and system reduced-motion behavior; the same presentation is extended compatibly to upstream file cards.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — The reusable accessible ComposerAttachmentThumb implementation, configurable overlay/gutter remove placement, enlarged remove hit target, and attachment accessibility labels remain intact.
- `apps/mobile/src/components/ControlPill.tsx` — Preserved the useEffect cleanup required by T3 Pretty's deferred press-reset logic, preventing stale timers and duplicate activate-on-press-in dispatches.
- `apps/mobile/src/components/ControlPill.tsx` — Preserved useThemeColor-based control icon tinting for T3 Pretty themes and visual design.
- `apps/mobile/src/components/ControlPill.tsx` — Preserved the fork's AnchoredMenu abstraction at the existing AndroidAnchoredMenu module path rather than regressing its name and integration back to AndroidAnchoredMenu.
- `apps/mobile/src/features/sharing/IncomingShareProvider.tsx` — The 10-second timeout and timer cleanup protecting shared-file metadata resolution from hanging.
- `apps/mobile/src/features/sharing/IncomingShareProvider.tsx` — T3 Pretty's composer image-preview generation for incoming image shares.
- `apps/mobile/src/features/sharing/IncomingShareProvider.tsx` — Rollback cleanup for generated composer preview files, preventing failed share ingestion from leaking preview artifacts.
- `apps/mobile/src/features/sharing/incoming-share-inbox.test.ts` — Preserved T3 Pretty’s reliability coverage requiring rollback to run exactly once when durable incoming-share persistence fails.
- `apps/mobile/src/features/sharing/incoming-share-inbox.test.ts` — Preserved the surrounding guarantees that a failed durable write neither acknowledges the payload nor performs cleanup.
- `apps/mobile/src/features/sharing/incoming-share-inbox.ts` — Preserved T3 Pretty's explicit rollback contract for removing app-owned files created before the durable inbox write commits.
- `apps/mobile/src/features/sharing/incoming-share-model.test.ts` — Durable incoming-share persistence remains covered through encodeIncomingShareDraftForPersistence, including stripping base64 image data before persistence.
- `apps/mobile/src/features/sharing/incoming-share-model.test.ts` — T3 Pretty's raw image-size preflight remains explicitly tested so oversized or unreadable image data is rejected before preview creation or base64 retention.
- `apps/mobile/src/features/sharing/incoming-share-model.test.ts` — The existing T3 Pretty composer-preview file helper and image-share behavior remain intact alongside the parent additions.
- `apps/mobile/src/features/sharing/incoming-share-storage.ts` — Compact incoming-share persistence that removes attachment payloads only after previews are stored in app-owned files, while retaining payloads for non-owned previews that may disappear.
- `apps/mobile/src/features/sharing/incoming-share-storage.ts` — Load-time attachment hydration and migration of legacy data-backed previews into app-owned composer preview files.
- `apps/mobile/src/features/sharing/incoming-share-storage.ts` — Sequential attachment processing to limit transient memory use, with cleanup rollback for preview files created before a migration failure.
- `apps/mobile/src/features/sharing/incoming-share-storage.ts` — Graceful handling of unavailable shared images, including user-facing warnings and persisted-draft rewrite tracking.
- `apps/mobile/src/features/sharing/incoming-share-storage.ts` — Injectable attachment storage operations used to support reliability testing and controlled preview cleanup.
- `apps/mobile/src/features/threads/GitActionProgressOverlay.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Pretty's Reanimated composer behavior, including named animation hooks and stable KeyboardStickyView style identities used to avoid keyboard-layout regressions.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Pretty's asynchronous composer dispatch state, explicit dispatch-status presentation, minimum send-indicator duration, and attachment preview typing.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Pretty's optimistic new-thread registration and cleanup plus outgoing attachment previews, preserving immediate thread starts and cross-surface send reliability.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Pretty's EmptyState recovery UI, GlassSurface visual design, and existing ComposerSurface presentation.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Pretty's instant-apply provider/model settings architecture, including provider option defaults and the ThreadSettingsPickerPopover used for the fork's model and skills UX.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Pretty's custom composer and keyboard presentation remains in place around the parent's replacement voice-input implementation.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — T3 Pretty's composer dispatch safeguards remain authoritative: submitting, pasted-image preparation, and parent media/file preparation all lock selectors and task start.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — T3 Pretty's native dictation state continues to disable task start and editor mutation, alongside the parent voice-input controller.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The fork-only NewTaskSkills context route remains available.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Cold-start auto-PR preference hydration remains mandatory before Start, and pull-request handoffs retain their branch-selection exception.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — T3 Pretty's immediate optimistic thread-entry architecture is preserved, including branch/worktree context, enabled skills, creation/send timestamps, remapped initial message text, and outgoing attachment tracking.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Pending pasted-image previews and their preparation lifecycle remain intact.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — World Scenery presentation remains intact: the environment control stays inside NewTaskGlassChip and the composer dock does not apply an opaque sheet background while scenery chrome is active.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The fork-specific composerSelectorsLocked safeguards continue to protect environment, workspace, and branch selection during T3 Pretty lifecycle states such as attachment preparation.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The attachment strip remains gated by stripAttachments, matching the transformed/renderable attachment collection rather than the raw flow collection.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Incoming-share transfer and dispatch safeguards continue to prevent attachment removal during unsafe lifecycle states.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The fork-only Skills control and its existing selector locking remain unchanged.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — T3 Pretty's instant-apply ThreadSettingsPickerPopover remains authoritative, including model, option, and runtime callbacks.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The fork-only automatic pull-request toggle remains available in the new-task toolbar.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — World Scenery-aware toolbar fade colors and sheet fallback styling are retained.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Dispatch progress remains visible through the loading send button, dispatch-specific accessibility status, and ComposerDispatchStatusLabel.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Incoming-share, dispatch, and centralized composer interaction locks continue to protect attachment and settings actions.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The iOS live-IME draftKeyboardAvoidStyle remains in place, preserving the form-sheet under-lift and stale-keyboard-height safeguards.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The fork's NewTaskDraftFrame hierarchy and mobile presentation remain intact.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Generated work-log images retain workspace-relative and absolute path handling, asset URL loading, loading/error states, optional image opening, and fixed-height feed measurement, including pending images.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Work-log row derivation remains memoized by the activities array so copy-feedback and expansion repaints do not repeat detail normalization.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Disclosure feedback retains T3 Pretty's layout animation, selection haptic, and rejected-haptic handling safeguard.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — T3 Pretty's existing row enter/exit and layout-transition imports and behavior remain available alongside the new shimmer implementation.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Reduced-motion behavior remains protected: the parent shimmer is parked when Reduce Motion is enabled and also stops when the app is inactive or the screen is unfocused.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Animated per-row terminal-status affordances remain visible for failure, success, and intermediate states, including T3 Pretty's layout transition behavior.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — The work-log group-toggle label remains inside a fixed-height, overflow-clipped animated container, preserving T3 Pretty's non-stacking transition behavior while using the parent's new summary text.
- `apps/mobile/src/features/threads/use-project-actions.ts` — Preserved registration of the new thread's original draft attachments under its outgoing message ID, which keeps images visible after sending a new thread.
- `apps/mobile/src/lib/composer-image-schema.ts` — Preserved the T3 Pretty persisted image attachment schema in which `dataUrl` is optional, preventing draft keystrokes from repeatedly serializing large base64 image payloads while allowing rehydration from the preview URI.
- `apps/mobile/src/lib/composerImages.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/src/lib/projectThreadStartTurn.ts` — Skill selection remains part of thread bootstrap through SkillId and enabledSkillIds.
- `apps/mobile/src/lib/projectThreadStartTurn.ts` — Native provider sessions continue to receive the dedicated resumed-thread title through parseNativeResumeCommand and NATIVE_RESUME_THREAD_TITLE.
- `apps/mobile/src/lib/projectThreadStartTurn.ts` — Auto-PR agent instructions remain excluded from user-facing derived thread titles through stripCreatePullRequestSuffix.
- `apps/mobile/src/lib/threadActivity.test.ts` — Mobile working-indicator behavior: assistant commentary suppresses a redundant working row, while filtered live tool calls keep it visible.
- `apps/mobile/src/lib/threadActivity.test.ts` — Working-indicator ordering and stale-tool safeguards across streaming text, later tool groups, fresh user messages, and tools left over from earlier turns.
- `apps/mobile/src/lib/threadActivity.test.ts` — The fork’s generic work-log overflow presentation, including its visible tail row and expandable hidden rows.
- `apps/mobile/src/lib/threadActivity.test.ts` — Generated-image visibility without zero-count toggles.
- `apps/mobile/src/lib/threadActivity.test.ts` — Incremental feed derivation, out-of-order rebuild behavior, completion collapsing, and stable row, fold, and working-indicator identities.
- `apps/mobile/src/lib/threadActivity.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/src/state/thread-outbox-manager.ts` — Environment outbox files are removed sequentially, preventing a large offline queue from bursting open many file operations while environment teardown concurrently performs SQLite and draft cleanup.
- `apps/mobile/src/state/thread-outbox-model.ts` — Preserved T3 Pretty's schema-level enforcement of PROVIDER_SEND_TURN_MAX_INPUT_CHARS for queued message text.
- `apps/mobile/src/state/thread-outbox-model.ts` — Preserved T3 Pretty's schema-level enforcement of PROVIDER_SEND_TURN_MAX_ATTACHMENTS for queued message attachments.
- `apps/mobile/src/state/thread-outbox.test.ts` — Preserved T3 Pretty's regression coverage requiring persisted outbox payloads to reject text exceeding PROVIDER_SEND_TURN_MAX_INPUT_CHARS and attachment counts exceeding PROVIDER_SEND_TURN_MAX_ATTACHMENTS.
- `apps/mobile/src/state/thread-outbox.ts` — Updated queued messages continue registering their draft attachments so image previews remain available after sending or rewriting an outbox entry.
- `apps/mobile/src/state/use-composer-drafts.test.ts` — Preserved the T3 Pretty SkillId import required by the fork's mobile skill selection and draft-management behavior.
- `apps/mobile/src/state/use-composer-drafts.ts` — T3 Pretty's stale atomic-write temporary-file cleanup remains imported alongside atomic draft persistence.
- `apps/mobile/src/state/use-composer-drafts.ts` — The fork's bounded-growth intent remains intact: ordinary appends are capped against live draft state and rejected attachments are released through the generalized cleanup path.
- `apps/mobile/src/state/use-composer-drafts.ts` — The fork's failed-enqueue reliability intent remains intact through the parent's first-party allowOverflow restoration path, which preserves both failed-message attachments and attachments added concurrently.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Delivery-aware composer sends remain intact, including standard queue/steer delivery metadata for messages sent mid-turn.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Provider-aware runtime-mode remapping remains authoritative, so display-only Yolo values are not sent instead of the provider-compatible access mode.
- `apps/mobile/src/state/use-thread-composer-state.ts` — The composer still clears immediately after enqueue publication and restores failed queue writes without dropping text or attachments added while persistence was in flight.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Queue-write, picker, and paste failures continue to use T3 Pretty's immediate native alert presentation rather than being routed only through connection-error state.
- `apps/mobile/src/state/use-thread-composer-state.ts` — The optional picked-preview callback is retained around the upstream media picker so T3 Pretty's mobile image-send progress and preview UX can continue to receive immediate selections.
- `apps/mobile/src/state/use-thread-outbox-drain.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/server/src/http.ts` — Asset-route request logging remains disabled through HttpMiddleware.withLoggerDisabled.
- `apps/server/src/http.ts` — Attachment feed preview variants continue to resolve through resolveAttachmentFeedPreview using the configured attachments directory, attachment identity, and source path.
- `apps/server/src/http.ts` — The resolved preview path continues to be used for file serving and response-header inference.
- `apps/server/src/http.ts` — Asset source metadata continues to be passed to assetResponseHeaders, preserving source-specific fork behavior.
- `apps/server/src/provider/Layers/GrokProvider.test.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/server/src/provider/Layers/GrokProvider.ts` — Grok continues to advertise `supportsNativeResume: true`, preserving T3 Pretty's native session-resume integration.
- `apps/server/src/usage/usagePricing.test.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/server/src/usage/usagePricing.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/server/src/usage/usageScanCache.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/browser/browserRecording.test.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/browser/browserRecording.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/ChatMarkdown.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/ChatView.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/DiffPanel.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/chat/ChatComposer.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/chat/ComposerBannerStack.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/chat/ExpandedImageDialog.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/chat/MessagesTimeline.test.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/chat/MessagesTimeline.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/chat/ThreadSyncStatusPill.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/files/FileBrowserPanel.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/files/FilePreviewPanel.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/components/settings/settingsSearch.test.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/index.css` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/session-logic.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/web/src/versionSkew.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `docs/user/source-control.md` — kept the fork side wholesale as a fork-side fallback resolution
- `packages/client-runtime/package.json` — kept the fork side wholesale as a fork-side fallback resolution
- `patches/@legendapp__list@3.3.5.patch` — kept the fork side wholesale as a fork-side fallback resolution

## Parent changes integrated at conflict boundaries

- `pnpm-lock.yaml` — took the parent nightly's generated lockfile wholesale instead of AI-splicing it
- `apps/mobile/package.json` — Updated expo-audio from ~57.0.0 to the parent's ~57.0.4 dependency version.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — The strip now consumes the parent's generalized DraftComposerAttachment model rather than being limited to image attachments.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — The parent's first-party non-image attachment presentation is incorporated, including document icon, filename, sizing, theming, and removal by generalized attachment ID.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Attachment-facing documentation and rendering semantics are generalized from images to all supported attachment variants.
- `apps/mobile/src/components/ControlPill.tsx` — Integrated the parent's memoized menu-action icon color processing through useMemo and withMenuActionIconColors.
- `apps/mobile/src/components/ControlPill.tsx` — Integrated the parent's Uniwind bridge and ColorValue typing used to pass themed regular and destructive icon colors into the native MenuView.
- `apps/mobile/src/components/ControlPill.tsx` — Integrated the parent's View dependency for the updated control/menu layout while adapting its anchored-menu integration to the fork's existing AnchoredMenu API.
- `apps/mobile/src/features/sharing/IncomingShareProvider.tsx` — Generalized the metadata helper name to resolvedPayloadsForFiles and kept call sites consistent.
- `apps/mobile/src/features/sharing/IncomingShareProvider.tsx` — Detected generic file, audio, and video payloads and avoided unnecessary image metadata resolution when they are present.
- `apps/mobile/src/features/sharing/IncomingShareProvider.tsx` — Added bounded persistence of incoming attachments using PROVIDER_SEND_TURN_MAX_FILE_BYTES.
- `apps/mobile/src/features/sharing/IncomingShareProvider.tsx` — Added file-size reads for parent attachment validation and tracked persisted files for rollback cleanup.
- `apps/mobile/src/features/sharing/incoming-share-inbox.test.ts` — Adopted the parent’s `toHaveBeenCalledOnce()` matcher refactor for the rollback assertion.
- `apps/mobile/src/features/sharing/incoming-share-inbox.ts` — Integrated the parent's optional asynchronous rollback callback on built incoming-share drafts.
- `apps/mobile/src/features/sharing/incoming-share-model.test.ts` — Imported the parent's owned-root URI predicate and incoming-share attachment selection helpers.
- `apps/mobile/src/features/sharing/incoming-share-model.test.ts` — Added parent coverage for persisting shared PDFs and other files on disk without converting them to base64.
- `apps/mobile/src/features/sharing/incoming-share-model.test.ts` — Added generic file-size-limit, unreadable-file, video-import, and temporary-file cleanup coverage.
- `apps/mobile/src/features/sharing/incoming-share-model.test.ts` — Added Android content-URI handling tests for post-copy sizing, under-reported and zero sizes, empty persisted copies, display names, and source/copy ownership.
- `apps/mobile/src/features/sharing/incoming-share-model.test.ts` — Added destination-server capability and per-server file-size selection tests, including pending configuration and unsupported-file warnings.
- `apps/mobile/src/features/sharing/incoming-share-storage.test.ts` — Replaced the fork-only incoming-share persistence test implementation at this add/add conflict boundary with the parent’s first-party storage implementation, as required by the parent-replacement exception.
- `apps/mobile/src/features/sharing/incoming-share-storage.test.ts` — Integrated the parent’s hoisted Expo FileSystem mocks and per-test cleanup.
- `apps/mobile/src/features/sharing/incoming-share-storage.test.ts` — Integrated coverage that malformed persisted shares are skipped with a warning during normal loading.
- `apps/mobile/src/features/sharing/incoming-share-storage.test.ts` — Integrated strict-mode coverage requiring malformed persisted shares to reject with IncomingShareStorageError.
- `apps/mobile/src/features/sharing/incoming-share-storage.test.ts` — Integrated the parent’s vite-plus/test source for vi.
- `apps/mobile/src/features/sharing/incoming-share-storage.ts` — Added the optional `strict` setting to `loadIncomingShareDrafts`, enabling the surrounding parent load logic to rethrow invalid persisted-share errors instead of always logging and skipping them.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The parent's first-party mobile voice-input implementation—dictation toolbar actions, status presentation, controller, presentation resolver, atom registry, and server-environment routing—replaces the fork-only useNativeDictation/usePreparedConnection path.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The provider-wide send-turn attachment maximum and the new ComposerAttachmentButton are integrated alongside Pretty's richer attachment status UI.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The upstream COMPOSER_LAYOUT_TRANSITION composer animation is imported without removing Pretty's existing animation support.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Incoming shared attachments can use the parent's server-aware selection helper.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The thread-outbox removal API refactor is adopted by importing removeThreadOutboxMessage from thread-outbox-removal.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The parent composer interaction lock and in-flight-submit navigation safeguard are integrated into the stronger fork lock.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The parent voice controller now blocks media/file picking and submission when busy, and freezes the editor through its read-only state.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The image-only picker is replaced with the parent's photo/video media picker, including server upload capability and video-size handling.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The parent's file picker is added with server availability checks and maximum upload size enforcement.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Parent attachment-cap rejection reporting, picker error aggregation, and photo/video/file-specific alerts are retained.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The parent uploaded-attachment reconciliation callback is added to the fork-shaped optimistic starting-thread registration and flushes the updated draft.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — All ordinary upstream worktree branch gating remains effective while accommodating T3 Pretty's pull-request checkout handoff.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Environment and workspace controls now also honor isComposerInteractionLocked and voiceInput.isBusy.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The branch control now also honors the parent's generalized isComposerInteractionLocked state.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The command popover is suppressed while host-routed voice input is busy.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The composer dock adopts the parent's 12-pixel horizontal spacing outside and inside scenery presentation.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The attachment strip adopts the parent's 14-pixel horizontal alignment.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Attachment removal now also respects the parent's generalized interaction lock and voice-input busy state.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Replaced the fork-only toolbar dictation control with the parent's first-party voiceInput implementation, including animated presentation, cancel, recording status, levels, elapsed time, error dismissal, start, stop, and availability handling.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Integrated the parent's media-and-file attachment control, including server capability gating for file attachments.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Integrated the parent's centralized composer interaction lock into attachment, model, plan-mode, and PR controls.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Integrated the parent's share-import lock into the first-party dictation primary action.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Integrated the parent's animated composer layout transition and box-none pointer-event handling.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Integrated the parent's conditional send presentation through voicePresentation.showsSend while retaining Pretty's dispatch progress behavior.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Added the parent's native masked-gradient shimmer for live work-log rows, including measured sweep width and highlighted icon/text rendering.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Integrated parent lifecycle and accessibility controls for shimmer animation: app-state tracking, navigation focus tracking, animation cancellation, and Reduce Motion observation.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Integrated the parent work-log presentation type and expanded Reanimated/SVG dependencies required by the new presentation and animation behavior.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Adopted the parent's simplified collapsed-row height model while composing T3 Pretty's generated-image height contribution into it.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Adopted the parent's direct consumption of the already-presented activities array instead of applying the obsolete visibleWorkLogActivities filtering layer.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — The group toggle now uses the parent's summary-driven contract instead of the obsolete onlyToolActivities-based previous-entry labels.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Failure-aware accessibility labels are derived from hasFailure and summary.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — The parent summary-kind symbol, shimmer presentation, static summary presentation, and expanded/collapsed chevron are incorporated.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — The parent's text styling and visible summary content are retained inside the fork's animation container.
- `apps/mobile/src/features/threads/use-project-actions.ts` — Validate initial file attachments against the active environment's server configuration before starting the thread.
- `apps/mobile/src/features/threads/use-project-actions.ts` — Prepare and upload turn attachments, persisting uploaded draft references through onAttachmentsUploaded.
- `apps/mobile/src/features/threads/use-project-actions.ts` — Convert attachment upload failures and unavailable attachments into surfaced pending connection errors and failed AsyncResults.
- `apps/mobile/src/features/threads/use-project-actions.ts` — Revalidate prepared draft attachments before passing the prepared attachment payload to startTurn.
- `apps/mobile/src/features/threads/use-project-actions.ts` — Retained the parent pipeline's prepared attachment lifecycle used by the surrounding startTurn and upload-release code.
- `apps/mobile/src/lib/composer-image-schema.ts` — Added the parent draft file-attachment schema, including local file URI, optional uploaded attachment ID, and optional upload environment ID.
- `apps/mobile/src/lib/composer-image-schema.ts` — Added the parent draft attachment union supporting both image and file attachments.
- `apps/mobile/src/lib/projectThreadStartTurn.ts` — Added UploadChatImageAttachment typing for pre-uploaded image attachments alongside ChatFileAttachment.
- `apps/mobile/src/lib/projectThreadStartTurn.ts` — Adopted DraftComposerAttachment so the start-turn specification supports the parent's generalized composer attachment model while retaining image conversion for attachments that have not already been uploaded.
- `apps/mobile/src/lib/threadActivity.test.ts` — Structured `workEntry` metadata for command activities, including command text, labels, timestamps, turn identity, and tool tone.
- `apps/mobile/src/lib/threadActivity.test.ts` — Upstream command-overflow presentation using the generated `work-group:activity-1` identity, a collapsed `Ran 3 commands` summary with three hidden completed rows, and toggle-first ordering when expanded.
- `apps/mobile/src/state/thread-outbox-manager.ts` — Environment clearing removes only the revision-stable `candidates` captured for this clear request rather than every matching message from `allMessages`.
- `apps/mobile/src/state/thread-outbox-manager.ts` — Successful storage removals are recorded in `removedFromStorage`, preserving compatibility with upstream's subsequent same-ID enqueue restoration, reconciliation, and accurate removed-message reporting.
- `apps/mobile/src/state/thread-outbox-model.ts` — Adopted DraftComposerAttachmentSchema so the outbox accepts the parent's generalized composer attachment model rather than the older image-only schema.
- `apps/mobile/src/state/thread-outbox.test.ts` — Integrated the parent test verifying generic file attachment paths and upload metadata round-trip through outbox encoding and decoding without embedding file contents.
- `apps/mobile/src/state/thread-outbox.ts` — Added the optional expectedRevision argument to updateThreadOutboxMessage and forwarded it to the manager's compare-and-swap update implementation.
- `apps/mobile/src/state/thread-outbox.ts` — Integrated the parent documentation describing revision-aware update rejection.
- `apps/mobile/src/state/use-composer-drafts.test.ts` — Integrated upstream CommandId, MessageId, and ThreadId contract imports for expanded composer-draft test coverage.
- `apps/mobile/src/state/use-composer-drafts.test.ts` — Integrated upstream onTestFinished test cleanup support while retaining vi.
- `apps/mobile/src/state/use-composer-drafts.ts` — Adopted the parent's first-party DraftComposerAttachment model and DraftComposerAttachmentSchema, enabling generalized composer attachments instead of image-only drafts.
- `apps/mobile/src/state/use-composer-drafts.ts` — Integrated attachment file-reference tracking through composerAttachmentFileReferenceKey and the generalized unused-attachment cleanup path.
- `apps/mobile/src/state/use-composer-drafts.ts` — Integrated the upstream append API's allowOverflow behavior, provider-limit enforcement, rejection count, and support for restoring failed sends.
- `apps/mobile/src/state/use-composer-drafts.ts` — Replaced the fork-only image-specific append and failed-send restoration implementation with the parent's generalized first-party implementation.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Added the send-time attachment-cap guard for overflow drafts restored after a failed enqueue, preventing permanently unrecoverable outbox messages.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Deferred composer attachment cleanup until durable enqueue success, preventing an attachment sweep from deleting files during a failed write rollback.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Restored failed enqueue attachments with allowOverflow so recovery never silently discards user files.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Adopted the parent media picker and its photo/video behavior, including server-advertised video upload limits and combined picker/cap error reporting.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Added the parent file picker with server capability checks, contract-clamped upload limits, attachment-cap handling, and combined error reporting.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Added explicit reporting when pasted attachments are rejected because the composer attachment limit has been reached.
- `apps/server/src/http.ts` — Explicit asset MIME types are now passed to assetResponseHeaders even when the asset is not marked for download.
- `apps/server/src/http.ts` — Filename metadata follows upstream's expanded header-options path when either download handling or an explicit MIME type is present.
- `apps/server/src/provider/Layers/GrokProvider.ts` — Removed `requiresNewThreadForModelChange: true` from Grok presentation metadata, matching the parent provider's updated model-change behavior.

## Parent changes intentionally omitted

- `apps/desktop/src/preview/Manager.test.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/desktop/src/preview/Manager.test.ts after 3 attempts
- `apps/desktop/src/preview/Manager.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/desktop/src/preview/Manager.ts after 3 attempts
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Unconditional preview/remove interaction from the parent's attachment renderer while an attachment is preparing or the composer is busy.. Reason: Only the busy/preparing portion is omitted. T3 Pretty intentionally disables image preview and hides removal during reading/sending to prevent composer races and accurately communicate send progress; upstream interactions remain available when idle.
- `apps/mobile/src/features/threads/GitActionProgressOverlay.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/mobile/src/features/threads/GitActionProgressOverlay.tsx after 3 attempts
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The parent's retained useThreadSettingsSheetPresentation and NavigationWithFinishTransitioning settings-sheet wiring.. Reason: T3 Pretty intentionally replaced that legacy sheet path with its authoritative instant-apply ThreadSettingsPickerPopover/provider-options architecture. Restoring the old presentation path would regress the fork's redesigned model and skills picker.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Use the parent's bare, unwrapped environment-control presentation.. Reason: The NewTaskGlassChip wrapper is required by T3 Pretty's World Scenery and themed glass presentation; all parent interaction behavior was retained inside that wrapper.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Apply bg-sheet to the composer dock unconditionally.. Reason: T3 Pretty intentionally leaves the dock background transparent when sceneryChrome is active so World Scenery remains visible. The parent background remains applied in ordinary sheet mode.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Gate attachment-strip rendering on flow.attachments.length.. Reason: T3 Pretty uses stripAttachments as the authoritative transformed/renderable collection, avoiding an empty or mismatched strip while attachments are prepared or remapped.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Use the parent's interaction predicates as exclusive replacements for the fork's existing locks.. Reason: That would weaken T3 Pretty's image-preparation, incoming-share, and dispatch safeguards. The parent predicates were added alongside the fork predicates instead.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Open model and reasoning settings through settingsSheetPresentation.open on a plain ComposerInlineControl.. Reason: This would regress T3 Pretty's newer instant-apply ThreadSettingsPickerPopover, including its model-option defaults and runtime/option callbacks.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Use the parent's plain ComposerActionButton with flow.submitting-only status for task dispatch.. Reason: This would remove T3 Pretty's dispatch spinner and richer dispatchStatus accessibility feedback; the parent's conditional send placement and start behavior are retained around the fork button.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Wrap the iOS composer in the parent's full-screen KeyboardStickyView.. Reason: T3 Pretty's live-IME draftKeyboardAvoidStyle specifically fixes formSheet measureInWindow under-lift and stale-height behavior. The compatible parent layout transition and pointer-event changes are applied directly to that fork-safe wrapper instead.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/mobile/src/features/threads/ThreadComposer.tsx after 3 attempts
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/mobile/src/features/threads/ThreadDetailScreen.tsx after 3 attempts
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/mobile/src/features/threads/ThreadFeed.tsx after 3 attempts
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Removal of the trailing per-row status glyph and its status slot.. Reason: That removal would regress T3 Pretty's explicit animated work-log status affordance and mobile streaming-animation behavior. The smallest conflicting parent portion is therefore omitted while the rest of the parent group-toggle redesign is integrated.
- `apps/mobile/src/lib/composerImages.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/mobile/src/lib/composerImages.ts after 3 attempts
- `apps/mobile/src/lib/threadActivity.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/mobile/src/lib/threadActivity.ts after 3 attempts
- `apps/mobile/src/state/thread-outbox-manager.ts` — Remove all clear-environment candidates concurrently with `Promise.all`.. Reason: Concurrent deletion conflicts with T3 Pretty's reliability safeguard against unbounded bursts of outbox file operations during parallel environment teardown. Only the concurrency strategy is omitted; upstream's candidate filtering, error handling, and removal tracking are retained.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Route queued-message persistence failures through setPendingConnectionError.. Reason: T3 Pretty intentionally presents queue persistence failures as immediate native alerts; retaining the parent state-routing mechanism as well would duplicate or alter the fork's established error UX.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Route clipboard paste errors and attachment-cap rejections through setPendingConnectionError.. Reason: The same parent errors are preserved and surfaced, but through T3 Pretty's authoritative immediate Alert presentation rather than connection-error state.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Enqueue the draft runtime mode directly without provider-driver remapping and without optional delivery metadata.. Reason: That form would regress T3 Pretty's provider access-mode correction and standard queue/steer delivery behavior; the compatible parent enqueue and cleanup improvements were composed around the fork values instead.
- `apps/mobile/src/state/use-thread-outbox-drain.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/server/src/provider/Layers/GrokProvider.test.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/server/src/usage/usagePricing.test.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/server/src/usage/usagePricing.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/server/src/usage/usageScanCache.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/browser/browserRecording.test.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/browser/browserRecording.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/ChatMarkdown.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/ChatView.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/DiffPanel.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/chat/ChatComposer.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/chat/ComposerBannerStack.test.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/chat/ComposerBannerStack.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/chat/ExpandedImageDialog.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/chat/MessagesTimeline.test.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/chat/MessagesTimeline.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/chat/ThreadSyncStatusPill.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/files/FileBrowserPanel.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/files/FilePreviewPanel.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/pullRequest/PullRequestRow.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/components/settings/settingsSearch.test.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/index.css` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/session-logic.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `apps/web/src/versionSkew.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `docs/user/source-control.md` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `packages/client-runtime/package.json` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback
- `patches/@legendapp__list@3.3.5.patch` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: the model-resolution deadline passed before the job timeout; taking the fork-side fallback

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.38-nightly.20260831.1240`
- Previously integrated parent nightly: `v0.0.38-nightly.20260831.1236`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Preserved the T3 Pretty new-task loading and recovery presentation through ActivityIndicator and the existing native UI imports.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Preserved World Scenery and themed draft-frame support through StyleSheet, useColorScheme, useMemo, ReactNode, and Expo Linking used for scenery presentation and attribution.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Preserved T3 Pretty's thread-open performance tracking by calling markThreadOpenStarted before scheduling the Thread route replacement.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Preserved the optimistic new-thread destination and replacement semantics; the existing StackActions.replace("Thread", ...) action remains intact.
- `apps/mobile/src/lib/threadActivity.ts` — Generated-image activities remain visible when a large activity group is collapsed; only older non-image activities become overflow.
- `apps/mobile/src/lib/threadActivity.ts` — Visible activities continue to be emitted as individual activity groups, preserving the fork's expandable file-change and compact-diff row behavior.
- `apps/mobile/src/lib/threadActivity.ts` — The WeakMap-backed singleton activity groups retain stable row identities and avoid rebuilding presentation objects on the mobile feed hot path.
- `apps/mobile/src/lib/threadActivity.ts` — The fork's existing hidden-activity toggle and `onlyToolActivities` semantics remain intact.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Integrated the parent's CommonActions, useFocusEffect, and NavigationAction imports needed by its updated focus-aware navigation lifecycle.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Integrated the parent's state-mediated setSubmitNavigationAction path instead of directly dispatching the route action, allowing the upstream submit/removal-guard behavior to operate.

## Parent changes intentionally omitted

- `apps/mobile/src/lib/threadActivity.ts` — The parent live-summary work-toggle block, including the nightly change from lifecycle-gated shimmer to `shimmer: live` so the summary shimmers until the turn or contiguous tool run settles.. Reason: T3 Pretty has replaced this summarized live-toggle path with visible per-activity singleton rows plus a separate overflow toggle. This function no longer has the parent's `activeTail`, `latestInProgressActivity`, `sourceGroup`, `isWorking`, or `unsettledTurnId` inputs, and its overflow toggle does not represent the live contiguous run. Taking the parent block would not compile and would remove the fork's generated-image visibility, compact-diff presentation, and stable row identities; assigning live shimmer to the unrelated overflow toggle would invent incorrect semantics.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.38-nightly.20260831.1241`
- Previously integrated parent nightly: `v0.0.38-nightly.20260831.1240`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning
- 2 file(s) took the fork-side fallback because no model resolution was available; review their omissions below

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Reduced-motion-aware FadeIn/FadeOut animations for composer preparation and dispatch status UI.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Busy and per-attachment preparing states continue to dim thumbnails, prevent image/video actions, and hide removal controls while a send is in progress.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Preparing and normal attachment accessibility labels remain available, including button semantics for image previews and attachment removal.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — The existing ComposerAttachmentThumb and ComposerDispatchStatusLabel fork APIs and behavior remain intact.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Remove-button overlay/gutter placement and T3 Pretty's existing attachment-strip presentation remain unchanged.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Pending attachment previews, attachment-picking state, dispatch status labels, and minimum send-indicator timing remain intact.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — World Scenery color-scheme/theme handling and the fork's project underline color remain available.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Composer selectors retain Pretty's dispatch/share-transfer locking safeguards.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — The fork-only new-task skills picker, selected-skill count, platform-specific icon, and accessibility labeling remain intact.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Voice-input busy-state interaction locks remain applied to the workspace control.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Preserved T3 Pretty's dispatch status label so new-task progress remains visible across composer dispatches.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Host-routed native voice dictation dependencies and error presentation, including the internal-build capability gate and Effect Option connection handling.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Pretty's optimistic attachment preparation previews and composer dispatch-status labeling.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — The hardened local send-busy lifecycle, minimum send-indicator duration, queue/retry tracking, and in-flight message state.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — The timer-tracked preview-close refocus lifecycle, including cleanup on unmount to prevent stale focus callbacks.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Pretty's attachable-app composer mentions, app avatar presentation, ranked path-menu augmentation, provider grouping, and instant model-picker support.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Pretty's existing composer styling dependencies and visual attachment-strip components.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — T3 Pretty's host-routed `dictation` lifecycle remains authoritative; the editor stays disabled while fork dictation is active and the parent `voiceInput` wrapper is not restored.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — The Pretty expanded/collapsed composer design, Android single-line centering, editor insets, and compact stop/send control pills are retained.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Attachment rendering continues to use `stripAttachments`, preserving queued, preparing, and in-flight attachment visibility rather than falling back to only the current draft array.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Pretty's custom image thumbnails retain their dark/light backgrounds, preparation indicator, and disabled interaction while dispatching or preparing.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — The expanded attachment strip keeps Pretty's sending-state `busy` presentation.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/src/lib/composerImages.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/src/lib/threadActivity.test.ts` — Preserved T3 Pretty tests requiring derived activity-group rows to retain identity across unrelated streaming-message updates.
- `apps/mobile/src/lib/threadActivity.test.ts` — Preserved incremental feed tests ensuring only identity-changed message rows are replaced while unchanged messages and work rows remain stable.
- `apps/mobile/src/lib/threadActivity.test.ts` — Preserved sorted-feed correctness for older replayed messages and equal-timestamp message reordering.
- `apps/mobile/src/lib/threadActivity.test.ts` — Preserved loaded-message window equivalence between the incremental builder and stateless feed derivation.
- `apps/mobile/src/lib/threadActivity.test.ts` — Preserved behavior that activity groups are rebuilt when an initially hidden streaming message becomes visible.
- `apps/mobile/src/lib/threadActivity.ts` — T3 Pretty's shell/tool display formatting, including compact changed-file diffs, redundant-output suppression, leftover sibling-path preservation, and display-section serialization.
- `apps/mobile/src/lib/threadActivity.ts` — The centralized deriveWorkLogEntry path used by T3 Pretty's incremental mobile feed derivation and stable row handling.
- `apps/mobile/src/lib/threadActivity.ts` — Existing mobile work-log rules for generated headlines, terminal child-agent signals, internal-agent activity, plan boundaries, runtime warnings, and other filtered lifecycle events.
- `apps/server/src/http.test.ts` — T3 Pretty's bounded JSON request-body tests remain intact, including acceptance at the exact UTF-8 byte limit.
- `apps/server/src/http.test.ts` — T3 Pretty's split-stream overflow test continues to verify immediate rejection and the exact RequestBodySizeLimitExceededError metadata.
- `apps/server/src/http.ts` — Preserved T3 Pretty attachment feed previews selected by the `variant` query parameter, including preview generation from the configured attachments directory.
- `apps/server/src/http.ts` — Preserved the complete resolved asset metadata—including source, download disposition, filename, and MIME information—while replacing only its served path with the generated preview path when applicable.
- `apps/server/src/http.ts` — Preserved the logger-disabled middleware wrapping the asset route and the existing 404/500 response behavior.
- `apps/web/src/components/ChatView.tsx` — The T3 Pretty build-flavor identity remains available through T3CODE_BUILD_FLAVOR for fork-specific branding behavior.
- `apps/web/src/components/ChatView.tsx` — MessagesTimeline continues treating a currently working or not-yet-settled latest turn as active, preserving T3 Pretty's active-turn rendering behavior.
- `apps/web/src/components/chat/MessagesTimeline.logic.test.ts` — Preserved T3 Pretty's duplicate-thinking-indicator fix: adjacent active tool calls produce a single `work-live` row rather than an additional `working` row.
- `apps/web/src/components/chat/MessagesTimeline.logic.test.ts` — Preserved the test's one-replacing-row semantics while retaining the existing grouped-entry assertions for completed and running tool calls.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The required activeTurnInProgress input and its propagation through TimelineRowActivityState remain intact.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Generated live headlines remain reactive through the activity-state memo dependency list.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — T3 Pretty's compact inline turn-plan row remains collapsed by default, expandable in place, and retains its progress segments, status styling, keyboard focus treatment, animation, and reduced-motion behavior.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Generated live activity headlines continue to replace the static Thinking label when TimelineRowActivityCtx provides one.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The standard Thinking label remains as the fallback when no generated headline is available.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Existing LiveActivityRow presentation, including shimmer behavior and row-height continuity, remains intact.
- `apps/web/src/routes/_chat.draft.$draftId.tsx` — T3 Pretty's shared `ThreadRouteView` architecture for draft routes, including the fork's fix that avoids a screen flash when a newly promoted thread starts.
- `apps/web/src/routes/_chat.draft.$draftId.tsx` — The minimal route-module boundary, preventing the older inline draft rendering and navigation lifecycle from bypassing fork-specific shared route behavior.
- `apps/web/src/session-logic.test.ts` — Preserved T3 Pretty's generated-headline behavior by retaining the test that turn.headline activities are omitted while completed tool activity remains visible.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Parent reusable ComposerAttachmentThumbnail implementation for image, file, compact, and video attachment rendering.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Parent native video attachment detection through videoMimeType and VideoAttachmentTile integration.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Parent local video preview/share flow, including abort-on-unmount cleanup, share progress locking, preview disposal, and user-facing share errors.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Parent onPressVideo callback and stable draft video source identifiers are wired through the attachment strip.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — Parent thumbnail refactor is composed with the fork's send-progress safeguards rather than retaining the older fork-only file rendering path.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Added native local video attachment preview support, including source state, modal imports, and restoring composer focus when the preview closes.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Restored composer focus tracking and settings-sheet presentation wiring.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Added the accessible shimmering “Setting up worktree…” state for connected worktree submissions.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Made the upstream theme binding available for the worktree progress icon color.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Retained upstream's revised workspace-control sizing and normal/submitting conditional structure.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Integrated the parent mobile video preview modal, including its preview source and close handler.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Generalized draft attachment typing through DraftComposerAttachment.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — First-party file/video attachment support through DraftComposerFileAttachment, ComposerAttachmentButton, ComposerAttachmentThumbnail, VideoPreviewModal, and VideoPreviewSource.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Mutually exclusive image and video preview state and callbacks.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — The navigation focus guard that prevents restoring editor focus after navigating away from the thread composer.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — The parent's removal of obsolete inline React Native Image and AppSymbol imports.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Added the parent's `onPressVideo` handling to the expanded attachment strip.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Integrated the parent's `ComposerAttachmentThumbnail` for compact non-image attachments, providing native file/video thumbnail behavior and video preview actions.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Disabled newly integrated compact attachment preview actions during dispatch to fit T3 Pretty's existing runner and interaction safeguards.
- `apps/mobile/src/lib/threadActivity.test.ts` — Integrated upstream coverage that routine setup-script requested/started notices remain hidden while setup failures stay visible, retain failure status, expose diagnostic copy text, and behave consistently before and during a turn.
- `apps/mobile/src/lib/threadActivity.test.ts` — Integrated upstream coverage that error-toned setup-script requested and started events remain visible as failure activities.
- `apps/mobile/src/lib/threadActivity.ts` — Imported the parent's isWorktreeSetupActivity classifier.
- `apps/mobile/src/lib/threadActivity.ts` — Non-error worktree setup activity is now omitted from the mobile work log, while setup failures remain visible.
- `apps/mobile/src/lib/threadActivity.ts` — Applied the parent filtering behavior inside the fork's per-activity helper so it also covers incremental derivation paths rather than only full-array derivation.
- `apps/server/src/http.test.ts` — Added the parent Node HTTP/services test layer used to exercise filesystem-backed asset responses.
- `apps/server/src/http.test.ts` — Added upstream coverage for valid fixed, open-ended, suffix, and oversized video byte ranges, including 206 status and range headers.
- `apps/server/src/http.test.ts` — Added upstream coverage ensuring malformed, multipart, inverted, non-byte, absent, and conditionally inapplicable ranges fall back to full downloads.
- `apps/server/src/http.test.ts` — Added upstream coverage for case-insensitive video MIME handling and for preventing range semantics on non-video assets.
- `apps/server/src/http.test.ts` — Added upstream coverage for 416 responses on unsatisfiable ranges and empty video files.
- `apps/server/src/http.ts` — Integrated upstream's `assetFileResponse` path for asset delivery.
- `apps/server/src/http.ts` — Integrated upstream handling of `Range` and `If-Range` request headers, including only forwarding `Range` for GET requests.
- `apps/web/src/components/ChatView.tsx` — Removed the superseded CHAT_LIST_ANCHOR_OFFSET import in line with upstream's timeline anchoring refactor.
- `apps/web/src/components/ChatView.tsx` — Passed isPreparingWorktree to MessagesTimeline so upstream worktree preparation state can be represented in the timeline.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Added the optional isPreparingWorktree timeline input with a false default and propagated it through activity context state.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Integrated the parent's worktree-setup working-row presentation, including the setup label, shimmer overlay, keyed transition, fixed row height, and reduced-motion class.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Integrated the parent's reserved activity-row height during worktree setup and its handoff to LiveActivityRow once setup completes.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Retained both the fork turn-plan row and the parent's WorkingTimelineRow rather than choosing either implementation wholesale.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The parent’s current thinking-row placement and setup handoff remain intact, including reserving row height and suppressing content while the worktree is being prepared.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The parent’s LiveActivityRow implementation continues to render the activity content; the fork helper only supplies the context-aware label.
- `apps/web/src/routes/_chat.draft.$draftId.tsx` — The resolved route has no stale dependency on `threadHasStarted`, consistent with upstream's removal of that route-local predicate.
- `apps/web/src/session-logic.test.ts` — Added parent coverage that routine setup-script.requested and setup-script.started updates are omitted both before work and when followed by activity from later turns.
- `apps/web/src/session-logic.test.ts` — Added parent coverage that setup-script.failed entries retain their error label, detail, and null turn ID.
- `apps/web/src/session-logic.test.ts` — Added parent coverage that unrelated displayable runtime warnings without a turn ID remain in the work log.

## Parent changes intentionally omitted

- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Wrap the composer in the parent's `ComposerDictationDraftContent` and restore `ComposerDictationStartAction` backed by `voiceInput`.. Reason: That would replace T3 Pretty's newer host-routed, hardened dictation lifecycle and regress its custom composer controls.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Restore the parent's collapsed `ComposerAttachmentButton` for media and file picking.. Reason: It conflicts with T3 Pretty's intentionally reworked compact composer layout and fork attachment toolbar architecture.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Use the parent's generic `ComposerAttachmentThumbnail` for compact image attachments as well as videos/files.. Reason: The generic image path would remove T3 Pretty's preparing/loading visualization, dispatch lockout, theme-aware thumbnail background, and queued `stripAttachments` behavior; only the smallest conflicting image portion is retained from the fork.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/mobile/src/features/threads/ThreadFeed.tsx after 3 attempts
- `apps/mobile/src/lib/composerImages.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/mobile/src/lib/composerImages.ts after 3 attempts
- `apps/web/src/components/chat/MessagesTimeline.logic.test.ts` — Parent expectation that the derived timeline contains both `working` and `work-live` rows during an adjacent active tool run.. Reason: This conflicts directly with T3 Pretty's authoritative behavior that the live tool row replaces the separate working row, protecting the fork's duplicate-indicator fix.
- `apps/web/src/components/chat/MessagesTimeline.logic.test.ts` — Parent assertion that the retained `working` row has `showThinking: false`.. Reason: T3 Pretty intentionally emits no `working` row in this state, so the property assertion is inapplicable and retaining that row would weaken the fork behavior.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Remove ThinkingActivityRow and render a hard-coded Thinking label directly at the relocated call site.. Reason: That smallest portion conflicts with T3 Pretty’s generated live-headline feature. Keeping a thin context-aware helper preserves the fork behavior without changing the parent’s row placement or lifecycle logic.
- `apps/web/src/routes/_chat.draft.$draftId.tsx` — Upstream's inline `DraftChatThreadRouteView` hunk, including its revised `resolveDraftPromotionNavigationTarget` call that passes `serverThread` directly.. Reason: T3 Pretty has intentionally superseded this route-local implementation with `./-threadRouteView` to prevent the new-thread screen flash and centralize route lifecycle behavior. Restoring the inline parent component would bypass and regress that authoritative fork fix; any equivalent resolver API adaptation belongs in the shared implementation rather than resurrecting the deleted component here.

---

# Additional reconciliation with newer T3 Pretty main

- Parent nightly: `v0.0.38-nightly.20260901.1243`
- Previously integrated parent nightly: `v0.0.38-nightly.20260831.1241`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning
- 4 file(s) took the fork-side fallback because no model resolution was available; review their omissions below

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/app.config.ts` — T3 Pretty remains the named mobile app in the iOS local-network permission prompt.
- `apps/mobile/app.config.ts` — T3 Pretty branding is applied to the newly added iOS photo-library permission prompt without changing its upstream behavior.
- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/src/features/review/ReviewCommentComposerSheet.tsx` — Pending attachment previews remain tracked through ComposerAttachmentPreview entries.
- `apps/mobile/src/features/review/ReviewCommentComposerSheet.tsx` — Image preparation continues to derive isPreparingImages from pending previews, protecting submission and attachment actions while pasted or picked images are being prepared.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — T3 Pretty's normalized `stripAttachments` presentation remains authoritative, preserving its composed attachment and incoming-share preview behavior instead of reverting to the raw flow-only list.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — T3 Pretty's hardened dispatch lifecycle remains visible through `ComposerDispatchStatusLabel`, minimum send-indicator support, and detailed accessibility labels during dispatch.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Existing video-preview behavior remains available while being adapted to the parent's unified preview lifecycle.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/mobile/src/lib/composerImages.ts` — The picker remains nonblocking by avoiding picker-side base64 encoding, preserving the in-place preparing-thumbnail progress flow driven by onPicked.
- `apps/mobile/src/lib/composerImages.ts` — Selected image bytes are read through the already-loaded expo-file-system File implementation rather than relying on optional picker base64 data.
- `apps/mobile/src/lib/composerImages.ts` — Both file metadata and the actual encoded payload remain bounded by the 10 MB provider image limit.
- `apps/mobile/src/lib/composerImages.ts` — Draft previews continue to use app-owned files so they survive beyond temporary picker URIs and persisted drafts that omit dataUrl.
- `apps/mobile/src/lib/composerImages.ts` — The function retains its image-only input/output contract and populates nextImages, avoiding incompatible references to the parent's generalized attachments array and maxVideoBytes API.
- `apps/mobile/src/lib/composerImages.ts` — Supported original PNG, GIF, and WebP file bytes remain intact, preserving transparency and animation.
- `apps/mobile/src/lib/projectThreadStartTurn.ts` — Preserved SkillId typing for enabledSkillIds, which supports T3 Pretty's mobile skill selection and thread bootstrap behavior.
- `apps/mobile/src/state/use-composer-drafts.ts` — Persisted draft text and handoff prompts remain bounded by the provider input limit during decode.
- `apps/mobile/src/state/use-composer-drafts.ts` — Image payloads omitted from the compact persisted document are marked with an empty data URL and rehydrated from app-owned preview files; missing files are dropped without retaining newly empty drafts.
- `apps/mobile/src/state/use-composer-drafts.ts` — Stale bare model selections on empty new-task drafts are cleared so project, sticky, and provider model precedence is recalculated.
- `apps/mobile/src/state/use-composer-drafts.ts` — Contentless drafts carrying native share-import receipts remain retained to prevent duplicate share imports after restart.
- `apps/mobile/src/state/use-composer-drafts.ts` — Persisted-state open, read, decode, and hydration failures continue to throw a structured ComposerDraftPersistenceError rather than silently discarding Pretty user state.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Delivery-aware queueing remains intact, including the optional queue/steer delivery mode placed on outbox messages.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Provider-aware model selection and runtime-mode remapping remain intact, including preservation of stored provider-specific modes.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Native Codex feedback commands continue to use the dedicated feedback submission flow, status tracking, success/error alerts, and feedback-ID copying.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Optimistic draft clearing, deferred attachment cleanup, and uncapped attachment restoration after durable enqueue failures remain intact.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Queue persistence failures continue to use T3 Pretty's immediate, specifically labeled "Could not queue message" alert rather than being represented as a connection error.
- `apps/mobile/src/state/use-thread-outbox-drain.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/server/src/auth/EnvironmentAuth.test.ts` — Preserved T3 Pretty's hardened regression intent: rejecting an over-scoped token exchange must not consume the ordinary pairing grant, allowing a subsequent correctly scoped exchange to succeed.
- `apps/server/src/auth/EnvironmentAuth.ts` — Preserved T3 Pretty's ambient-cookie WebSocket Origin validation, including trusted t3code://app and t3code-dev://app desktop renderer origins, strict HTTP(S) origin parsing, and WS(S)-to-HTTP(S) same-origin normalization.
- `apps/server/src/auth/EnvironmentAuth.ts` — Preserved the preferExplicitAuthorization behavior so explicit Bearer or DPoP credentials take precedence over cookies where requested, without weakening the existing DPoP-bound token verification path.
- `apps/server/src/auth/SessionStore.test.ts` — Preserved T3 Pretty’s authentication-session hardening imports for active-session limits, client user-agent limits, credential limits, subject limits, and typed session IDs.
- `apps/server/src/bin.test.ts` — Preserved the T3 Pretty `CONNECT_BRANDING` import used by fork-specific Connect branding behavior and tests.
- `apps/server/src/environment/ServerEnvironment.test.ts` — Preserved T3 Pretty's filesystem test adaptation that exercises persisted environment ID read failures through `FileSystem.open` rather than the obsolete `readFileString` stub.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — Preserved the structural-efficiency optimization that computes the latest user-message timestamp with a database aggregate instead of loading every message body.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — Preserved direct aggregate queries for actionable proposed plans, pending user input, and pending approvals rather than materializing complete projection collections.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — Preserved the latest-turn-aware actionable-plan calculation used by T3 Pretty's thread shell summaries.
- `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts` — Preserved the merged pull-request settlement candidate contract, including observed branch identity and event provenance.
- `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts` — Preserved cross-repository branch-head metadata used to avoid settling the wrong pull request or repository.
- `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts` — Preserved paginated candidate scanning via afterThreadId and limit for reliable automatic settlement.
- `apps/server/src/persistence/Layers/ProjectionThreadActivities.ts` — T3 Pretty's countPendingUserInputByThreadId repository API remains available.
- `apps/server/src/persistence/Layers/ProjectionThreadActivities.ts` — The fork's efficient SQL-backed pending user-input count behavior remains wired through, including its handling of resolved requests and stale/unknown response-failure states.
- `apps/server/src/server.test.ts` — Preserved imports for HTTP_MAX_REQUEST_BODY_BYTES and WEBSOCKET_MAX_MESSAGE_BYTES, maintaining T3 Pretty's server reliability and transfer-limit test coverage.
- `apps/server/src/usage/usageScanCache.ts` — Preserved T3 Pretty's runtime usage-provider validation through isUsageProviderKind, including support for the fork's expanded provider set.
- `apps/server/src/usage/usageScanCache.ts` — Preserved the USAGE_MODEL_MAX_LENGTH trust-boundary limit used to harden persisted cache hydration.
- `apps/web/src/components/ChatMarkdown.tsx` — Generated-image expansion remains exposed exactly once and grouped with the fork's generatedImagePaths behavior, avoiding duplicate TypeScript properties and destructured bindings.
- `apps/web/src/components/ChatMarkdown.tsx` — The fork's sanitizer policy continues to omit CODEX_ARTIFACT_TEMPLATE_HAST_PROPERTIES from raw div elements rather than restoring a removed allowance.
- `apps/web/src/components/ChatMarkdown.tsx` — MemoizedReactMarkdown remains the rendering boundary, preserving T3 Pretty's markdown hot-path optimization and avoiding unnecessary parsing and rendering work.
- `apps/web/src/components/chat/MessagesTimeline.logic.test.ts` — Active adjacent tool calls remain represented by one replacing `work-live` row, avoiding the duplicate thread working/thinking indicator that T3 Pretty intentionally removed.
- `apps/web/src/components/chat/MessagesTimeline.logic.test.ts` — A latest completed tool call remains the sole replacing row while the turn continues, without additional `working` or trailing `thinking` rows.
- `apps/web/src/components/chat/MessagesTimeline.logic.test.ts` — Coverage continues to verify that the selected tool entry and all grouped entries are retained in the replacing row.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — T3 Pretty's single in-thread working indicator behavior, avoiding the duplicate trailing thinking indicator previously removed by the fork.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — Active-turn suppression of the working indicator when assistant text, an in-progress tool, a proposed plan, or a turn plan already provides visible activity.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — T3 Pretty's visibility filtering for grouped live tool entries, including omission of superseded or otherwise hidden lifecycle markers.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Turn-plan timeline rows continue to render through T3 Pretty's TurnPlanTimelineRow.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Thinking activity continues to use TimelineRowActivityCtx.liveHeadline through ThinkingActivityRow, preserving generated live activity headlines rather than reverting to a static label.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Live work-entry rows continue to prefer T3 Pretty's generated live headline when one is available.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The setup-to-thinking handoff retains its reserved minimum height and suppresses thinking content while the worktree is being prepared.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Preserved T3 Pretty's openPullRequestLinkOnHost integration for opening pull-request links through the fork's host-aware behavior.
- `apps/web/src/components/settings/settingsSearch.ts` — Surge Connect account branding continues to use SURGE_CODE_ACCOUNT_NAME rather than a parent-branded hard-coded name.
- `apps/web/src/components/settings/settingsSearch.ts` — World Scenery theme identity remains available to settings search through WORLD_SCENERY_THEME_ID.
- `apps/web/src/components/settings/settingsSearch.ts` — Settings marked sceneryOnly remain hidden unless the World Scenery theme is active, preventing search results from targeting absent controls.

## Parent changes integrated at conflict boundaries

- `apps/mobile/app.config.ts` — Added NSPhotoLibraryAddUsageDescription so iOS can present a purpose string when the app saves images to the photo library.
- `apps/mobile/src/features/review/ReviewCommentComposerSheet.tsx` — Replaced the image-URI-only preview state with the parent's FilePreviewSource-based previewFile state, enabling the newer generalized FilePreviewModal flow.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Integrated attachment-upload tracking through `composerAttachmentUploadsAtom` and `composerAttachmentUploadBlockReason`.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Passed the selected environment identifier to `ComposerAttachmentStrip`, enabling environment-scoped upstream upload state while retaining the fork's attachment list.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Surfaced upstream attachment-upload blocking reasons in the send button's accessibility label and retained the parent's explicit `flow.submitting` fallback.
- `apps/mobile/src/features/threads/NewTaskDraftScreen.tsx` — Adopted the parent's first-party `FilePreviewModal` implementation and shared `closeMediaPreview` lifecycle for both file and video previews.
- `apps/mobile/src/lib/composerImages.ts` — Added a defensive post-picker slot limit so an over-returning picker cannot exceed the remaining attachment count.
- `apps/mobile/src/lib/composerImages.ts` — Integrated asset.type-aware validation in addition to MIME-based validation.
- `apps/mobile/src/lib/composerImages.ts` — Normalized and trimmed selected attachment names.
- `apps/mobile/src/lib/composerImages.ts` — Integrated JPEG payload-signature handling so stale or incorrect picker MIME metadata is corrected to image/jpeg and the filename receives a .jpg extension.
- `apps/mobile/src/lib/composerImages.ts` — Used a data URL as the fallback preview when corrected MIME metadata no longer matches the picker URI, while still preferring Pretty's durable app-owned preview file.
- `apps/mobile/src/lib/composerImages.ts` — Retained the parent's intent to validate size from the actual base64 payload rather than trusting picker metadata alone.
- `apps/mobile/src/lib/projectThreadStartTurn.ts` — Integrated upstream cleanup removing the unused UploadChatImageAttachment contract import.
- `apps/mobile/src/state/use-composer-drafts.ts` — Decode the persisted cloud account identifier and signed-out cloud draft collections.
- `apps/mobile/src/state/use-composer-drafts.ts` — Deserialize queued messages stored with signed-out cloud drafts through decodeQueuedThreadMessage.
- `apps/mobile/src/state/use-composer-drafts.ts` — Return decoded cloud-draft state from successful persisted composer-state loads alongside rehydrated local drafts and sticky model selection.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Sending is now blocked when composerAttachmentUploadBlockReason reports that current attachments cannot be uploaded because of connection state, server capabilities/configuration, or tracked upload state.
- `apps/mobile/src/state/use-thread-composer-state.ts` — The send callback now depends on the environment connection state and the complete server configuration, preventing stale attachment eligibility and provider configuration from being captured.
- `apps/server/src/auth/EnvironmentAuth.test.ts` — Integrated the parent regression test verifying that a valid bearer token takes precedence over a stale legacy session cookie in web mode.
- `apps/server/src/auth/EnvironmentAuth.ts` — Integrated upstream's exported selectRequestCredential abstraction and source-tagged credential results.
- `apps/server/src/auth/EnvironmentAuth.ts` — Integrated support for sessions.legacyCookieName as the lowest-priority credential fallback.
- `apps/server/src/auth/EnvironmentAuth.ts` — Retained upstream's normal credential precedence: current cookie, then Bearer authorization, then DPoP authorization, then legacy cookie.
- `apps/server/src/auth/SessionStore.test.ts` — Integrated the parent’s EnvironmentId contract import used by the environment-aware SessionStore test layers.
- `apps/server/src/bin.test.ts` — Integrated the parent `HostProcessEnvironment` import needed to provide the service in `DisconnectedLauncherChildLayer`.
- `apps/server/src/environment/ServerEnvironment.test.ts` — Integrated the parent's `makeTempFileScoped` test implementation so write attempts use the controlled temporary path and continue asserting atomic persistence failures correctly.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — Integrated the upstream user-input-lifecycle filtering intent: `countPendingUserInputByThreadId` directly computes only pending user-input state and avoids the broader activity listing that upstream replaced with `listUserInputLifecycleByThreadId`.
- `apps/server/src/orchestration/Layers/ProjectionPipeline.ts` — Retained concurrent execution of all four independent thread shell-summary reads.
- `apps/server/src/orchestration/Services/ProjectionSnapshotQuery.ts` — Added ProjectionThreadDetailQuery with optional activityKinds filtering, including the documented optimized behavior for explicit filters and empty filter lists.
- `apps/server/src/persistence/Layers/ProjectionThreadActivities.ts` — Added the parent listUserInputLifecycleByThreadId repository implementation.
- `apps/server/src/persistence/Layers/ProjectionThreadActivities.ts` — Preserved the parent's SQL/decode error mapping and activity-row mapping for lifecycle results.
- `apps/server/src/persistence/Layers/ProjectionThreadActivities.ts` — Exported the parent lifecycle-listing method from the repository implementation.
- `apps/server/src/server.test.ts` — Integrated the parent HTTP_ROUTER_CONFIG import while retaining makeRoutesLayer.
- `apps/server/src/usage/usageScanCache.ts` — Integrated the parent's node:path namespace import for its new path-handling logic.
- `apps/server/src/usage/usageScanCache.ts` — Preserved the parent's Effect diagnostics override for the Node built-in import.
- `apps/web/src/components/ChatMarkdown.tsx` — Added the extraRemarkPlugins ChatMarkdown API with EMPTY_REMARK_PLUGINS as its stable default.
- `apps/web/src/components/ChatMarkdown.tsx` — Used the upstream-composed remarkPlugins list so caller-provided plugins run in addition to the normal or hard-break plugin set.
- `apps/web/src/components/ChatMarkdown.tsx` — Added dataPullRequestAutolink to the sanitized anchor attribute allowlist so upstream pull-request autolink metadata reaches the custom link renderer.
- `apps/web/src/components/chat/MessagesTimeline.logic.test.ts` — Explicitly verify that an in-progress grouped tool run does not emit a standalone `thinking` row.
- `apps/web/src/components/chat/MessagesTimeline.logic.test.ts` — Verify that a `work-live` row whose latest tool call has completed is marked `active: false`.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Working rows now use the parent's WorkingTimelineRow instead of directly rendering the thinking activity.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The parent's distinct `thinking` timeline-row kind and ThinkingTimelineRow structure are integrated.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — Thinking activity is separated from the working timer row, matching the parent's revised timeline model.
- `apps/web/src/components/chat/MessagesTimeline.tsx` — The updated liveWorkEntryLabel API receives row.active, preserving the parent's active-state-aware fallback labeling.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Integrated the parent PullRequestMarkdownContext import used by the upstream pull-request Markdown implementation.
- `apps/web/src/components/settings/settingsSearch.ts` — Added the isWindowsPlatform utility used by settings search.
- `apps/web/src/components/settings/settingsSearch.ts` — Added windowsOnly metadata to SettingsSearchItem alongside the fork-specific sceneryOnly metadata.
- `apps/web/src/components/settings/settingsSearch.ts` — Windows-only settings, including the WSL backend entry, are filtered out when the browser platform is not Windows, preventing results from targeting missing anchors.

## Parent changes intentionally omitted

- `apps/mobile/src/components/ComposerAttachmentStrip.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/mobile/src/components/ComposerAttachmentStrip.tsx after 3 attempts
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/mobile/src/features/threads/ThreadComposer.tsx after 3 attempts
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/mobile/src/features/threads/ThreadFeed.tsx after 3 attempts
- `apps/mobile/src/lib/composerImages.ts` — Generalized video attachment handling using input.maxVideoBytes, createComposerFileAttachment, and the attachments result array.. Reason: The conflict boundary is the fork's image-only pickComposerImages API, whose signature returns images and has no maxVideoBytes or generalized attachments collection. Inserting the parent hunk would reference unavailable API state and regress the fork's image preparation and durable-preview flow.
- `apps/mobile/src/lib/composerImages.ts` — Picker-provided base64 and its native iOS JPEG conversion path for unsupported source formats such as HEIC.. Reason: Pretty deliberately disables picker-side base64 because it blocks picker completion and previously left the composer without timely thumbnails or send progress. The resolution instead reads original files asynchronously and adopts JPEG signature correction when those bytes are already JPEG; unsupported non-JPEG provider formats remain rejected rather than restoring the blocking behavior.
- `apps/mobile/src/state/use-composer-drafts.ts` — Warn and ignore persisted composer-state failures by returning empty local drafts, sticky selection, and cloud-draft state.. Reason: This conflicts with T3 Pretty's hardened persistence behavior, which must surface structured load and hydration failures instead of silently replacing potentially recoverable user state with empty state. The compatible cloud-state success path is still integrated.
- `apps/mobile/src/state/use-thread-composer-state.ts` — Route an outbox persistence failure through setPendingConnectionError.. Reason: T3 Pretty intentionally presents this local durable-queue failure as an immediate, specifically labeled queue error. Also setting a pending connection error would duplicate the failure surface and misclassify a storage/queue failure as a connectivity problem.
- `apps/mobile/src/state/use-thread-outbox-drain.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: CLIProxyAPI did not produce a completed response for apps/mobile/src/state/use-thread-outbox-drain.ts after 3 attempts
- `apps/web/src/components/ChatMarkdown.tsx` — Restore the inherited CODEX_ARTIFACT_TEMPLATE_HAST_PROPERTIES allowlist on sanitized div elements.. Reason: OURS explicitly removed this allowance. Restoring it would broaden accepted raw-HTML div metadata and undo the fork's sanitizer policy; the new pull-request anchor metadata is integrated independently.
- `apps/web/src/components/ChatMarkdown.tsx` — Render through a direct ReactMarkdown component at this call site.. Reason: That would replace T3 Pretty's MemoizedReactMarkdown optimization and regress the fork's markdown hot path. The upstream remark-plugin behavior is fully adapted to the memoized wrapper instead.
- `apps/web/src/components/chat/MessagesTimeline.logic.test.ts` — Emit a separate `working` row before `work-live` for both active and just-completed tool runs.. Reason: This conflicts with T3 Pretty's authoritative replacing-row behavior and would restore the duplicate working/thinking presentation that the fork removed.
- `apps/web/src/components/chat/MessagesTimeline.logic.test.ts` — Append a standalone `thinking` row after the latest tool call completes while the turn remains running.. Reason: T3 Pretty intentionally keeps this state in its single replacing `work-live` presentation; adding another indicator would regress the fork's duplicate-indicator fix.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — The parent adds a separate `thinking` timeline-row variant, appends it whenever a working turn has no live work row, and compares it in stable-row equality.. Reason: That row can coexist with the existing `working` row and recreate the duplicate thinking indicator explicitly removed by T3 Pretty; preserving the fork's single-indicator behavior is authoritative.
- `apps/web/src/components/chat/MessagesTimeline.logic.ts` — The parent removes the active-turn visible-content and visible-tool-entry derivation at this conflict boundary.. Reason: The surrounding composed implementation still relies on these values for live-tool grouping and working-row suppression, and removing them would both leave unresolved references and regress T3 Pretty's handling of visible assistant content, tools, and plans.
