# Apps (remote MCP connections)

User-facing doc: [Apps](../user/apps.md). This page is the architecture.

## Shape

- **Contracts:** `packages/contracts/src/apps.ts` (records, RPC payloads, `AppsError`) and
  `packages/contracts/src/appsCatalog.ts` (built-in catalog; data only, every entry probed
  live for a Streamable HTTP endpoint). `ServerSettings.apps` holds the records but is
  deliberately absent from `ServerSettingsPatch`: clients mutate apps only through the
  `apps.*` RPCs, and the server writes the settings key itself through
  `ServerSettingsInternalPatch`.
- **Server:** `apps/server/src/apps/`
  - `AppsService.ts` — the only writer of records and credentials, serialized by one mutex.
    Credentials are one JSON blob per connection in `ServerSecretStore`
    (`apps-<base64url id>`): the OAuth client used (DCR result or the family's pre-registered
    client), the access/refresh token, expiry, and the RFC 8707 resource. Pre-registered
    client secrets live under `apps-oauth-client-<family>`.
  - `AppOAuth.ts` — stateless OAuth 2.1 helpers: RFC 9728 protected-resource discovery
    (`WWW-Authenticate: resource_metadata`, then the well-known candidates), RFC 8414 /
    OpenID metadata, RFC 7591 dynamic client registration, PKCE S256, code exchange and refresh.
  - `AppsHttp.ts` — `GET /api/apps/oauth/callback` (state-checked, unauthenticated) and the
    transparent proxy `ANY /mcp/apps/:connectionId`.
- **Provider attach:** `ProviderService.prepareMcpSession` issues the usual provider-scoped
  MCP credential and lists the servers to attach in
  `McpProviderSessionConfig.servers`: `t3-code` for browser tools,
  `t3-code-computer` at `${endpoint}/computer-use` for computer control, then one entry per
  attachable app (`enabled && (auth === "none" || authorizedAt !== null)`) at
  `${endpoint}/apps/<id>`. Each adapter maps that list into its own dialect (Claude
  `mcpServers` record, Codex `-c mcp_servers.<name>.*` with the shared
  `T3_MCP_BEARER_TOKEN` env var, ACP `mcpServers` array for Cursor/Grok/Kimi).
  Toggling or connecting an app applies to new sessions.
- **Mentions:** `packages/shared/src/appMentions.ts` — `@slug` in the user text, matched
  against attachable apps, adds a short `[Connected apps]` prelude in
  `ProviderCommandReactor`. The composer inserts `@slug` as plain text; the web chip
  rendering is purely cosmetic.

## Why a proxy

Providers already know how to reach T3's own MCP server with a per-session bearer. Putting
apps behind `/mcp/apps/<id>` means one injection shape for all six providers, upstream
tokens never land in provider config files or process args, refresh happens in one place
(a 401 upstream triggers one refresh-and-retry), and turning an app off is honored
server-side even for a running session. The proxy is byte-transparent: it forwards the
JSON-RPC body, `Accept`, `Mcp-Session-Id`, `MCP-Protocol-Version` and `Last-Event-ID`, and
streams the upstream response back, so it carries no MCP semantics and works for SSE
replies.

## Known ceilings

- `ponytail:` all attachable apps attach to every session. Per-thread selection would need
  per-thread state plus a session restart when the set changes.
- Legacy SSE-transport servers are unsupported (their `endpoint` event would need rewriting).
- Stdio MCP servers are out of scope; the proxy is HTTP-only by design.
- Orphaned credential blobs (record removed by hand-editing `settings.json`) are harmless
  but not garbage-collected.
