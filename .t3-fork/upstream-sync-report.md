# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260815.1098`
- Previously integrated parent nightly: `v0.0.34-nightly.20260815.1097`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/server/src/server.test.ts` — Preserved the AgentInstructionFiles test layer, including its empty default and per-test override hook.
- `apps/server/src/server.test.ts` — Preserved the SkillStore test layer, including installed-skills state and per-test overrides.
- `apps/server/src/server.test.ts` — Preserved the SkillMarketplace test layer, including list/refresh defaults and per-test overrides.
- `apps/server/src/server.test.ts` — Preserved the merged-layer structure used to stay within Effect Layer pipe argument limits.
- `apps/server/src/ws.ts` — T3 Pretty's intentional removal of the legacy local loadServerConfig generator, avoiding resurrection of a deleted configuration-delivery path.

## Parent changes integrated at conflict boundaries

- `apps/server/src/server.test.ts` — Added the parent RemoteOpenTargets test layer with an empty resolveTargets default.
- `apps/server/src/server.test.ts` — Retained the parent-compatible ExternalLauncher mock and its existing per-test override behavior.

## Parent changes intentionally omitted

- `apps/server/src/ws.ts` — Expose timeout-protected remoteOpenTargets discovery through the deleted loadServerConfig/server.getConfig path.. Reason: T3 Pretty removed this entire helper and its associated legacy configuration path. Reintroducing the helper would regress the fork's architecture, and the supplied conflict contains no active replacement configuration hook where this upstream field can be adapted safely.
