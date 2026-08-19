/**
 * Apps — external services (Gmail, GitHub, Linear, …) connected to an
 * environment through remote MCP servers (Streamable HTTP).
 *
 * The server owns the connection records and every credential. Each enabled,
 * authorized app is attached to every provider session as one more MCP
 * server, reached through the server's own `/mcp/apps/<id>` proxy so provider
 * CLIs only ever hold the short-lived provider-scoped MCP bearer they already
 * use for `t3-code`; upstream OAuth tokens never leave the server.
 *
 * Clients edit apps only through the `apps.*` RPCs; `ServerSettings.apps` is
 * server-written and read-only on the wire.
 *
 * @module apps
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

export const AppConnectionId = TrimmedNonEmptyString.pipe(Schema.brand("AppConnectionId"));
export type AppConnectionId = typeof AppConnectionId.Type;

/**
 * MCP server name as providers see it (`mcp__<slug>__<tool>` in Claude,
 * `mcp_servers.<slug>` in Codex) and the `@slug` mention token in the
 * composer. Lower-case so mentions match case-insensitively typed text.
 */
export const AppSlug = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9_-]{0,31}$/));
export type AppSlug = typeof AppSlug.Type;

/**
 * - `oauth`: OAuth 2.1 against the MCP server's authorization server (RFC 9728
 *   discovery, PKCE, dynamic client registration when offered, or a
 *   pre-registered client from `AppsSettings.oauthClients`).
 * - `token`: a user-pasted API key / personal access token sent as a header.
 * - `none`: open server, no credential.
 */
export const AppAuthKind = Schema.Literals(["oauth", "token", "none"]);
export type AppAuthKind = typeof AppAuthKind.Type;

/** Fields a client may set. */
export const AppConnectionInput = Schema.Struct({
  id: AppConnectionId,
  /** Catalog entry this was created from; `null` for a custom MCP server. */
  catalogId: Schema.NullOr(TrimmedNonEmptyString),
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  slug: AppSlug,
  /** Upstream Streamable HTTP MCP endpoint. */
  url: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
  auth: AppAuthKind,
  /** Space-separated OAuth scopes; empty = server default. */
  scopes: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  /**
   * `token` auth only: header carrying the credential. `Authorization` sends
   * `Bearer <token>`; any other name sends the raw token.
   */
  tokenHeader: TrimmedNonEmptyString.pipe(
    Schema.withDecodingDefault(Effect.succeed("Authorization")),
  ),
  enabled: Schema.Boolean,
});
export type AppConnectionInput = typeof AppConnectionInput.Type;

/** Server-owned status, folded onto the input. */
export const AppConnection = Schema.Struct({
  ...AppConnectionInput.fields,
  createdAt: Schema.Number,
  /** Epoch ms when a credential was last stored; `null` = not connected. */
  authorizedAt: Schema.NullOr(Schema.Number),
  /** Last auth/proxy failure worth showing; cleared on the next success. */
  lastError: Schema.NullOr(Schema.String),
});
export type AppConnection = typeof AppConnection.Type;

/**
 * Pre-registered OAuth client for authorization servers without dynamic
 * client registration (Google, GitHub, Slack, …), keyed by
 * `AppCatalogEntry.oauthClientFamily`. The secret lives in the secret store.
 */
export const AppOAuthClient = Schema.Struct({
  clientId: TrimmedNonEmptyString,
  hasClientSecret: Schema.Boolean,
});
export type AppOAuthClient = typeof AppOAuthClient.Type;

export const AppsSettings = Schema.Struct({
  connections: Schema.Record(AppConnectionId, AppConnection).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  oauthClients: Schema.Record(Schema.String, AppOAuthClient).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
export type AppsSettings = typeof AppsSettings.Type;

// ── RPC payloads ─────────────────────────────────────────────────────

export const AppsUpsertInput = Schema.Struct({ connection: AppConnectionInput });
export type AppsUpsertInput = typeof AppsUpsertInput.Type;

export const AppsRemoveInput = Schema.Struct({ connectionId: AppConnectionId });
export type AppsRemoveInput = typeof AppsRemoveInput.Type;

export const AppsAuthorizeInput = Schema.Struct({
  connectionId: AppConnectionId,
  /**
   * Origin the calling client reaches this server through (e.g.
   * `http://127.0.0.1:3773`, a tailnet name, a T3 Connect hostname). The OAuth
   * redirect lands on `<callbackOrigin>/api/apps/oauth/callback`, so it must
   * be reachable from the browser that completes the consent screen.
   */
  callbackOrigin: TrimmedNonEmptyString,
});
export type AppsAuthorizeInput = typeof AppsAuthorizeInput.Type;

export const AppsAuthorizeResult = Schema.Struct({ authorizationUrl: Schema.String });
export type AppsAuthorizeResult = typeof AppsAuthorizeResult.Type;

export const AppsSetTokenInput = Schema.Struct({
  connectionId: AppConnectionId,
  token: TrimmedNonEmptyString,
});
export type AppsSetTokenInput = typeof AppsSetTokenInput.Type;

export const AppsSetOAuthClientInput = Schema.Struct({
  family: TrimmedNonEmptyString,
  clientId: TrimmedString,
  /** Omitted = keep the stored secret; empty = clear it. */
  clientSecret: Schema.optional(TrimmedString),
});
export type AppsSetOAuthClientInput = typeof AppsSetOAuthClientInput.Type;

export const AppsDisconnectInput = Schema.Struct({ connectionId: AppConnectionId });
export type AppsDisconnectInput = typeof AppsDisconnectInput.Type;

export const AppsTestInput = Schema.Struct({ connectionId: AppConnectionId });
export type AppsTestInput = typeof AppsTestInput.Type;

export const AppsTestResult = Schema.Struct({
  serverName: Schema.NullOr(Schema.String),
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      description: Schema.NullOr(Schema.String),
    }),
  ),
});
export type AppsTestResult = typeof AppsTestResult.Type;

export const AppsOperation = Schema.Literals([
  "upsert",
  "remove",
  "authorize",
  "callback",
  "set-token",
  "set-oauth-client",
  "disconnect",
  "test",
  "proxy",
]);
export type AppsOperation = typeof AppsOperation.Type;

export class AppsError extends Schema.TaggedErrorClass<AppsError>()("AppsError", {
  operation: AppsOperation,
  connectionId: Schema.optional(AppConnectionId),
  message: TrimmedNonEmptyString,
  cause: Schema.optional(Schema.Defect()),
}) {}
