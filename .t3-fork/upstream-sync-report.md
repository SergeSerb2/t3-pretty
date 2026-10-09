# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261009.2873`
- Previously integrated parent nightly: `v0.0.46-nightly.20261009.2861`
- Conflict resolver: manual (scheduled sync Buildkite #3322 declined `apps/server/src/server.ts` as unsafe and then failed frozen install)

## T3 Pretty changes preserved at conflict boundaries

- `apps/server/src/server.ts` — Runtime still provideMerges one ACP registry catalog so search, prepare, status inspection, and turn launch share the same prepared-agent cache. The deleted local `AcpRegistryCatalogLive` alias is not restored.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — Every granted MCP server (built-in toolkits and connected apps) is still registered on the Claude query, not only `t3-code`.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — Per-thread agent-device environment still wraps Claude query startup through `withAgentDeviceEnvironment`.
- `packages/client-runtime/src/connection/routes.ts` — Default learned-route policy stays HTTPS-only. Production `learnRoutes` does not pass `allowInsecure`, so a browser page cannot learn mixed-content HTTP routes. Credential inheritance, route reconciliation, and Tailscale labeling remain unchanged.

## Parent changes integrated at conflict boundaries

- `pnpm-lock.yaml` — took the parent nightly's generated lockfile wholesale instead of keeping the broken auto-merge
- `apps/server/src/server.ts` — Catalog construction uses `@t3tools/provider-acp-registry/server/AcpRegistrySupport` `layerFromHost` provided with `ProviderHostLive.layer`. That is the replacement for the deleted `./provider/AcpRegistryCatalog.ts` named-alias layer. Both the obsolete local import and a second catalog constructor are omitted so provider initialization is not orphaned or duplicated at the server surface.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — MCP Authorization travels as `${T3_CODE_MCP_AUTHORIZATION}` plus `mcpEnvironment`, so the credential is not written into CLI-visible `mcpServers`.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — Upstream MCP environment is spread into the Claude query environment before the fork's agent-device wrapper.
- `packages/client-runtime/src/connection/routes.ts` — `reported` uses the parent's `ReportedEndpoint` (optional `kind` for Tailscale labeling). Optional `allowInsecure` opts into plaintext HTTP learning for callers that pass it; the default remains Pretty's HTTPS-only policy.

## Parent changes intentionally omitted

- `apps/server/src/server.ts` — The leftover `AcpRegistryCatalogLive` import from `./provider/AcpRegistryCatalog.ts`. Reason: that module was deleted when ACP Registry moved into `@t3tools/provider-acp-registry`. Keeping the alias would leave an unresolved import. `layerFromHost` is the same catalog plus runtime coordinator, built from `ProviderHost` paths.
- `packages/client-runtime/src/connection/routes.ts` — Required `allowInsecure: boolean` on every `mergeLearnedRoutes` call. Reason: Pretty's production path must stay HTTPS-only without every caller opting in. The field is optional; omitted/`false` keeps the fork policy.
- `packages/client-runtime/src/connection/routes.test.ts` — Parent Tailscale-label cases that learned plaintext `http://` addresses and expected them to persist through `connectionRoutes`. Reason: Pretty's catalog filter drops learned HTTP/ws routes. The same kind-based Tailscale labeling is covered with `https://` reports so the no-op third pass can see the kept learned routes.

## Post-merge repairs

- Regenerated `pnpm-lock.yaml` against the merged package manifests after the parent lockfile was taken wholesale. The scheduled sync's auto-merged lockfile was missing `@effect/platform-node@4.0.1` with the Effect 4 patch hash, so `pnpm install --frozen-lockfile` failed (`ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY`).
