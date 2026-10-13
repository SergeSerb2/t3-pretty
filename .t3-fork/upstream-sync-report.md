# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261012.3035`
- Previously integrated parent nightly: `v0.0.46-nightly.20261012.3021`
- Conflict resolver: `gpt-6.1-sol` with `xhigh` reasoning
- 1 file(s) took the fork-side fallback because no model resolution was available; review their omissions below

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/features/threads/thread-work-log.tsx` — Generated-image path selection retains Pretty's priority: savedPath, then the first generated path, then null.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — The generatedImage binding remains available to subsequent consumers, and non-generated-image rows retain workEntryViewedImagePath handling.
- `apps/web/src/components/LegacySidebar.tsx` — Retains the fork-added ThreadActiveSubagentIndicator import supporting active-subagent badges on sidebar thread rows.
- `apps/web/src/components/Sidebar.tsx` — kept the fork side wholesale as a fork-side fallback resolution

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/features/threads/thread-work-log.tsx` — Keep viewedImagePath defined before fetchedOutput evaluates it, without duplicate declarations.
- `apps/mobile/src/features/threads/thread-work-log.tsx` — Retain the parent's image-aware output fallback: fetched rows with output images or a viewed image path do not display the misleading "No output." message.
- `apps/web/src/components/LegacySidebar.tsx` — Adopts ThreadTerminalStatusButton in place of the legacy terminalStatusFromRunningIds and synchronizeTerminalPulse imports, which OURS had retained unchanged from BASE.

## Parent changes intentionally omitted

- `apps/web/src/components/Sidebar.tsx` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: apps/web/src/components/Sidebar.tsx was not safe to resolve automatically: These exact edits remove both conflict blocks, but the result is not safe to apply as a completed resolution. The supplied context contains imports, not the affected terminal and pull-request consumers. Provide the terminal render/effect sections and snapshot usages in apps/web/src/components/Sidebar.tsx, plus the current exports and implementations of ThreadTerminalStatusButton and synchronizeTerminalPulse in apps/web/src/components/ThreadStatusIndicators.tsx. That context is needed to verify export compatibility, retained subscriptions and motion behavior, reduced-motion handling, and whether the parent component preserves the existing terminal interactions.
