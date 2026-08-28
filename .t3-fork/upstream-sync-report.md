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
- `apps/server/src/http.ts` — Added the parent's RFC 6266 download Content-Disposition generation with sanitized ASCII fallback and UTF-8 filename* support.
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
