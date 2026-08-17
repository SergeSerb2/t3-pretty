# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260817.1116`
- Previously integrated parent nightly: `v0.0.34-nightly.20260817.1113`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/settings/settingsSearch.ts` — Global and project agent-instruction settings remain discoverable through settings search.
- `apps/web/src/components/settings/settingsSearch.ts` — T3 Pretty's subagent enablement and default-child-model settings remain discoverable.
- `apps/web/src/components/settings/settingsSearch.ts` — T3 Pretty's installed, environment-specific, and marketplace skills settings remain discoverable.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/settings/settingsSearch.ts` — Added the parent `Agent browser access` search item, routed to the browser section of integration settings.

## Parent changes intentionally omitted

- None. The resolver did not omit any parent change to protect T3 Pretty.
