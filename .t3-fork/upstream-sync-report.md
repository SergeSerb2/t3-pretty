# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260813.1087`
- Previously integrated parent nightly: `v0.0.34-nightly.20260813.1086`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/modules/t3-markdown-text/src/SelectableMarkdownText.ios.tsx` — Preserved the memoized MarkdownLinkCallbacksContext provider used to expose link press and long-press actions throughout native markdown rendering.
- `apps/mobile/modules/t3-markdown-text/src/SelectableMarkdownText.ios.tsx` — Preserved onLinkLongPress forwarding to selectable native markdown text so long-pressed chat links continue to offer copy/open actions.
- `apps/mobile/modules/t3-markdown-text/src/SelectableMarkdownText.ios.tsx` — Preserved the highlightCodeEnabled gate on rich native markdown blocks, retaining the fork's code-highlighting behavior and hot-path control.

## Parent changes integrated at conflict boundaries

- `apps/mobile/modules/t3-markdown-text/src/SelectableMarkdownText.ios.tsx` — Passed skills into NativeMarkdownBlock so upstream skill handling also applies to rich markdown chunks.

## Parent changes intentionally omitted

- None. The resolver did not omit any parent change to protect T3 Pretty.
