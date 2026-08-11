# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260811.1063`
- Previously integrated parent nightly: `v0.0.34-nightly.20260810.1062`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/BranchToolbarBranchSelector.tsx` — Preserved T3 Pretty’s Codex automated-review label and description in the branch PR tooltip.
- `apps/web/src/components/ChatView.tsx` — Right-panel content continues to use selectedRightPanelSurface, keeping rendered pull-request and Agents content synchronized with T3 Pretty's retained transition snapshot instead of switching to live state during an exit.
- `apps/web/src/components/ChatView.tsx` — InlineRightPanelPresence remains mounted around the inline panel, preserving T3 Pretty's right-panel open/close animation and delayed exit lifecycle.
- `apps/web/src/components/ChatView.tsx` — The presence snapshot retains the selected surface ID, rendered content, surface roster, and maximized state, protecting stable panel transitions and maximized-panel exit behavior.
- `apps/web/src/components/ChatView.tsx` — The fork's sheet-versus-inline lifecycle remains controlled through the presence component key and open state.
- `apps/web/src/components/RightPanelTabs.tsx` — T3 Pretty branding in the browser-preview disabled message.
- `apps/web/src/components/RightPanelTabs.tsx` — T3 Pretty's animated right-panel lifecycle through the optional open and onExitComplete props and their forwarding to PreviewPanelShell.
- `apps/web/src/components/preview/PreviewPanelShell.tsx` — The `open` and `onExitComplete` props remain available for T3 Pretty's stable right-panel enter/exit lifecycle and maximized-panel exit handling.
- `apps/web/src/components/preview/PreviewPanelShell.tsx` — `isResizing` remains sourced from `useResizableWidth`, preserving the `data-right-panel-resizing` state used to coordinate T3 Pretty's resize and transition behavior.
- `docs/user/source-control.md` — Documentation of T3 Pretty's Codex Auto Review public-state indicator, including reviewing, no issues, feedback, earlier-result, and no-public-signal states.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/BranchToolbarBranchSelector.tsx` — Integrated the parent tooltip wording that removes the obsolete “in browser” suffix and keeps the action label concise.
- `apps/web/src/components/ChatView.tsx` — Pull-request surfaces render a loading ghost while server capability is unknown.
- `apps/web/src/components/ChatView.tsx` — Unsupported servers render the upstream pull-request unavailable state and upgrade guidance.
- `apps/web/src/components/ChatView.tsx` — Supported pull-request surfaces render PullRequestDetailPanel with repository, project, number, thread/page context, stable keying, and status-change handling.
- `apps/web/src/components/ChatView.tsx` — The inline RightPanelTabs rendered inside InlineRightPanelPresence retains upstream pull-request creation, availability, and status props.
- `apps/web/src/components/ChatView.tsx` — The inline panel retains upstream terminalAvailable and agentsAvailable capability props; equivalent upstream props remain present for the sheet panel as well.
- `apps/web/src/components/ChatView.tsx` — The upstream active-surface rendering logic was adapted to T3 Pretty's selected snapshot surface so the new pull-request behavior participates in the fork's animation lifecycle.
- `apps/web/src/components/RightPanelTabs.tsx` — Configurable right-panel width persistence via widthStorageKey.
- `apps/web/src/components/RightPanelTabs.tsx` — Configurable initial right-panel width via defaultWidth.
- `apps/web/src/components/RightPanelTabs.tsx` — A terminal-specific disabled reason explaining that terminal surfaces require a project thread.
- `apps/web/src/components/preview/PreviewPanelShell.tsx` — Added and documented `widthStorageKey` so independently embedded preview surfaces can persist widths without clobbering one another.
- `apps/web/src/components/preview/PreviewPanelShell.tsx` — Added `defaultWidth` so callers can customize the initial panel width.
- `apps/web/src/components/preview/PreviewPanelShell.tsx` — Passed both width overrides through to `useResizableWidth` while retaining the existing preview-panel defaults as fallbacks.
- `docs/user/source-control.md` — Documentation for opening multiple reviews from the Pull requests page as right-panel tabs.
- `docs/user/source-control.md` — Documentation for opening reviews linked from a thread in compact right-panel tabs without leaving the conversation.

## Parent changes intentionally omitted

- `apps/web/src/components/RightPanelTabs.tsx` — Use “T3 Code desktop app” in the browser-preview disabled message.. Reason: This would regress the fork's authoritative T3 Pretty branding; only the product name is omitted while the parent tooltip behavior remains intact.
