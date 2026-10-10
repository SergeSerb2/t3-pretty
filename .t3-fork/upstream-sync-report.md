# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261009.2886`
- Previously integrated parent nightly: `v0.0.46-nightly.20261009.2873`
- Conflict resolver: manual (scheduled sync Buildkite #3328 resolved the modify/delete, then failed server typecheck; the AI repair declined)

## T3 Pretty changes preserved at conflict boundaries

- `packages/provider-core/src/server/mcpSession.ts` — Pretty still describes every granted MCP server (`servers`, typed capabilities, `builtInMcpServers`, `hasBrowserTools` / `hasComputerTools`). Adapters keep mapping that list into each provider dialect.
- `apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts` — Every granted MCP server is still registered on the Claude query, not only `t3-code`. Agent-device env still wraps query startup. The live session is read from `McpProviderSessions` and passed as `mcpSession`.
- `packages/provider-acp/src/server/adapter.ts` — The ACP MCP-over-ACP bridge still forwards every granted HTTP server. `AcpMcpContext` carries `sessionServers` from the session config instead of the removed module-level lookup.
- `apps/server/src/server.ts` — Pretty Apps/Skills layers stay provided. Event-logger construction keeps `T3CODE_LOG_PROVIDER_EVENTS_VERBOSE`.
- `apps/server/src/provider/EventNdjsonLogger.ts` — Verbose native-record retention stays on the store.
- `apps/web/src/components/Sidebar.tsx` — Pretty's project-folder sidebar is kept. Upstream #12113 only swapped `FolderIcon` for `ListFilterIcon` on a combobox Pretty no longer uses.

## Parent changes integrated at conflict boundaries

- MCP session storage is the new `McpProviderSessions` Effect service. Module-level `set`/`read`/`clear` helpers are gone. Adapters and tests take `mcpSession` or yield the service.
- `apps/server/src/provider/ProviderEventLoggers.ts` — parent deleted this live wrapper; the layer is inlined in `server.ts` and callers import `@t3tools/provider-core/server/ProviderEventLoggers`.
- `apps/server/src/sourceControl/SourceControlRepositoryService.ts` — destination `~` expansion uses the shared `expandHomePath` helper; the local duplicate is gone.
- Codex session event queues are unbounded `ProviderAdapter.ProviderAdapterV2Event` queues.
- Provider-testing host lives at `@t3tools/provider-testing/TestProviderHost`.
- `ProviderAdapterV2Shape` is `ProviderAdapterV2["Service"]`.

## Parent changes intentionally omitted

- `apps/web/src/components/Sidebar.tsx` — `ListFilterIcon` on the old project-filter combobox. Reason: Pretty already replaced that control with project-folder navigation, so the icon swap has no surface.
- `packages/provider-core/src/server/mcpSession.ts` — the parent's slimmer `McpProviderSessionConfig` (optional string capabilities, no `servers`). Reason: Pretty's multi-toolkit and connected-app MCP registration needs the typed server list.

## Post-merge repairs

- Port leftover `readMcpProviderSession` / `setMcpProviderSession` call sites onto `McpProviderSessions` and `mcpSession` arguments.
- Restore Pretty MCP fixture fields (`servers`, `capabilities`, `preview`) on helpers that now construct `McpProviderSessionConfig` values instead of mutating a process-wide map.
- Provide `McpProviderSessions.layer` on the three Claude adapter tests whose wake harness now requires the service.
- Rename the leftover `layerTest` call in `DesktopWindow.test.ts` to `makeTestLayer` so desktop typecheck matches the local helper.
