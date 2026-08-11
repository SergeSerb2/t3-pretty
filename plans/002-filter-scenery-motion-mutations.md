# 002 — Filter scenery motion mutations

- **Status**: IMPLEMENTED
- **Commit**: 0027a8a4
- **Severity**: HIGH
- **Category**: Performance
- **Estimated scope**: 2 files, about 100 lines including tests

## Problem

The motion driver observes every child-list mutation under `document.body` and
schedules a full sync for every batch:

```tsx
// apps/web/src/scenery/SceneryMotion.tsx:343 — current
const observer = new MutationObserver(() => {
  if (!queued) {
    queued = true;
    requestAnimationFrame(sync);
  }
});
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["data-timeline-row-id", "data-timeline-row-kind"],
});
```

Each sync queries all timeline wrappers, reads layout with
`getBoundingClientRect()`, searches working/pill/hero/sidebar slots, sorts all
timeline rows by screen position, and may update React portal state. Streaming
Markdown and one-second duration-label updates both create unrelated child-list
mutations, so the driver repeatedly does layout work even when no motion target
was mounted, removed, or reclassified.

## Target

Keep the single observer, but schedule a sync only when a mutation can change a
motion target:

- an observed timeline id/kind attribute changes;
- an added or removed element is, or contains, a timeline wrapper/row, working
  row, approval detail, scroll-to-end pill, draft hero, or working sidebar icon.

Text nodes, Markdown descendants, portal canvases, duration-label updates, and
unrelated application chrome must not schedule a sync. Relevant structural
changes must still coalesce into one rAF.

## Repo conventions to follow

- Keep selectors centralized beside the existing constants in
  `SceneryMotion.tsx`.
- Keep the observer as a structural compatibility layer; do not add new store
  subscriptions or cross-package contracts.
- Preserve the existing one-rAF coalescing, silent thread-switch window,
  virtualization history guard, and 5,000-id bound.

## Steps

1. Build one comma-separated structural selector from the existing target
   selectors plus `[data-timeline-row-kind]`, `[data-timeline-row-id]`, and
   `[data-approval-detail]`.
2. Add a helper that returns true for observed attribute records, or for
   child-list records whose added/removed element matches or contains the
   structural selector.
3. Pass mutation records to the observer callback and return without scheduling
   when the helper finds no relevant structural change.
4. Add focused tests or contract assertions that pin the filter and prove plain
   text/canvas mutations are ignored while row/sidebar/pill additions remain
   relevant.

## Boundaries

- Do NOT change row-arrival timing, orb-state inference, portal placement, or
  animation CSS.
- Do NOT disconnect the observer while a turn streams.
- Do NOT observe character data.
- Do NOT add polling, timeouts, or a second DOM observer.
- If upstream removes the data/ARIA hooks listed above, stop and update the
  structural contract instead of widening the observer to all DOM mutations.

## Verification

- **Mechanical**: run the focused mutation-filter and scenery contract tests,
  web typecheck, touched-file lint, and formatting check.
- **Feel check**: stream a response containing Markdown and tool calls. New rows
  still animate once, the orb changes verb when tool/approval rows appear, the
  scroll pill/sidebar slots still mount and unmount, and ordinary token updates
  do not trigger repeated full-layout scans in a performance recording.
- **Done when**: unrelated child-list mutations return before rAF scheduling,
  while every documented structural target still schedules exactly one
  coalesced sync.
