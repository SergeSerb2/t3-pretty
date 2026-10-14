# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261014.3093`
- Previously integrated parent nightly: `v0.0.46-nightly.20261013.3080`
- Conflict resolver: `gpt-6.1-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/server/src/mcp/OrchestratorMcpService.test.ts` — Regression coverage confirming driver-only delegation selects the Claude provider after its CLI becomes available, alongside the existing explicit-instance recovery coverage.
- `apps/server/src/mcp/OrchestratorMcpService.test.ts` — Assertions requiring the driver-target retry to perform the fourth provider probe and produce the second dispatch, protecting orchestrator recovery and client-safety expectations.
- `apps/web/src/components/files/BrowserDocumentFrame.tsx` — Retain initializeHtmlRenderTheme rather than reverting T3 Pretty's theme-initialization dependency to the base htmlRenderThemeFragment helper.
- `apps/web/src/components/files/BrowserDocumentFrame.tsx` — Retain loadRestrictedHtmlRender and the fork's restricted HTML-loading dependency; no rendering, sandbox, or handler code is removed or changed.
- `packages/contracts/src/git.test.ts` — VcsListRefsResult import and decoder remain available to the fork’s contract tests.
- `packages/contracts/src/git.test.ts` — VcsStatusResult import and decoder remain available to the fork’s status contract tests.
- `packages/contracts/src/git.test.ts` — The automated-review status fixture is preserved, including its distinction between an omitted automatedReview field and an explicitly supplied value.
- `packages/contracts/src/git.ts` — Keep GIT_LIST_BRANCHES_MAX_LIMIT publicly exported with its existing value of 200, preserving the contract available to fork consumers.

## Parent changes integrated at conflict boundaries

- `apps/server/src/mcp/OrchestratorMcpService.test.ts` — Use layerOrchestratorService instead of OrchestratorMcpService.layer when providing the test service, retaining the existing layerDependencies.
- `apps/web/src/components/files/BrowserDocumentFrame.tsx` — Import KeybindingCommand, KeybindingShortcut, and the thread/model-picker jump command lists needed by upstream HTML-render shortcut handling.
- `apps/web/src/components/files/BrowserDocumentFrame.tsx` — Import HtmlRenderShortcut and htmlRenderShortcutsMessage for upstream HTML-frame shortcut messaging.
- `apps/web/src/components/files/BrowserDocumentFrame.tsx` — Import ScopedThreadRef for the thread context forwarded from BrowserDocumentFrame to HtmlRenderDocument.
- `packages/contracts/src/git.test.ts` — Added the parent’s VcsStatusLocalResult import and schema decoder alongside the fork’s existing test helpers.
- `packages/contracts/src/git.ts` — Add the parent GitFilePath schema using non-empty string validation without trimming file-path whitespace.

## Parent changes intentionally omitted

- `apps/web/src/components/files/BrowserDocumentFrame.tsx` — THEIRS' htmlRenderThemeFragment import, which is unchanged from BASE.. Reason: OURS deliberately replaced this dependency with initializeHtmlRenderTheme and loadRestrictedHtmlRender. Preserve that fork replacement instead of restoring the legacy import; all parent-added imports are retained.
