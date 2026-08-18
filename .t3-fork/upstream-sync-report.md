# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260817.1120`
- Previously integrated parent nightly: `v0.0.34-nightly.20260817.1119`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — T3 Pretty's shared snoozed/settled shelf-header design, including distinct clock and checkmark-circle imagery, persistent labels and tabular counts, and fork-specific theme colors.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Screen, sidebar, and World Scenery spacing behavior, including the scenery-specific HOME_HORIZONTAL_INSET calculation.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — The unified settled-shelf implementation and its accessibility labels, hints, expanded state, press feedback, and 44-point minimum touch target.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Use a stable chevron.down symbol and rotate it 180 degrees for expanded shelves instead of swapping between chevron symbol names.
- `apps/mobile/src/features/threads/thread-list-v2-items.tsx` — Apply the upstream chevron behavior consistently to both snoozed and settled shelves through T3 Pretty's shared shelf-header component.

## Parent changes intentionally omitted

- None. The resolver did not omit any parent change to protect T3 Pretty.
