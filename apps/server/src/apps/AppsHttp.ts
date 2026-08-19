/**
 * HTTP surface for Apps:
 *
 * - `GET /api/apps/oauth/callback` — where the user's browser lands after
 *   consenting upstream. Unauthenticated by nature; the `state` nonce minted by
 *   `AppsService.authorize` is the whole check.
 * - `ANY /mcp/apps/:connectionId` — transparent Streamable HTTP proxy in front
 *   of an app's MCP server. Providers reach it with the same provider-scoped
 *   MCP bearer they use for `/mcp`; the server swaps in the upstream
 *   credential (refreshing OAuth tokens as needed) and streams the reply
 *   back untouched. Being byte-transparent means no MCP semantics live here.
 */
import { AppConnectionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import { APPS_OAUTH_CALLBACK_PATH, AppsService } from "./AppsService.ts";

export const APPS_MCP_PROXY_PREFIX = "/mcp/apps";

/** Request headers worth forwarding to the upstream MCP server. */
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
] as const;

/** Response headers worth forwarding back to the provider. */
const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "mcp-session-id",
  "mcp-protocol-version",
] as const;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export function renderAppsCallbackHtml(input: {
  readonly ok: boolean;
  readonly connectionName: string | undefined;
  readonly message: string;
}): string {
  const title = input.ok
    ? `${input.connectionName ?? "App"} connected`
    : `Could not connect ${input.connectionName ?? "app"}`;
  const body = input.ok ? "You can close this window and go back to T3 Code." : input.message;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light dark; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; padding: 32px 16px; }
      main { width: min(100%, 420px); text-align: center; }
      h1 { font-size: 20px; margin: 0 0 8px; }
      p { margin: 0; opacity: 0.72; line-height: 1.5; }
      .mark { display: inline-grid; place-items: center; width: 44px; height: 44px; border-radius: 999px; margin-bottom: 16px; font-size: 22px; background: ${input.ok ? "rgba(34,197,94,0.16)" : "rgba(239,68,68,0.16)"}; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark">${input.ok ? "✓" : "!"}</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(body)}</p>
    </main>
    <script>
      if (window.opener) { try { window.opener.postMessage({ type: "t3-apps-oauth", ok: ${input.ok ? "true" : "false"} }, "*"); } catch {} }
      ${input.ok ? "setTimeout(function () { window.close(); }, 1500);" : ""}
    </script>
  </body>
</html>`;
}

const callbackRoute = HttpRouter.add(
  "GET",
  APPS_OAUTH_CALLBACK_PATH,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const apps = yield* AppsService;
    const url = HttpServerRequest.toURL(request);
    const params = Option.isSome(url) ? url.value.searchParams : new URLSearchParams();
    const outcome = yield* apps.completeCallback({
      state: params.get("state"),
      code: params.get("code"),
      error: params.get("error"),
      errorDescription: params.get("error_description"),
    });
    return HttpServerResponse.text(renderAppsCallbackHtml(outcome), {
      status: outcome.ok ? 200 : 400,
      contentType: "text/html; charset=utf-8",
      headers: { "cache-control": "no-store" },
    });
  }),
);

const unauthorized = HttpServerResponse.jsonUnsafe(
  {
    error: "invalid_mcp_credential",
    message: "A valid provider-scoped MCP bearer credential is required.",
  },
  { status: 401, headers: { "cache-control": "no-store", "www-authenticate": "Bearer" } },
);

const proxyRoute = HttpRouter.add(
  "*",
  `${APPS_MCP_PROXY_PREFIX}/:connectionId`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const apps = yield* AppsService;
    const httpClient = yield* HttpClient.HttpClient;

    const authorization = request.headers.authorization;
    const bearer =
      authorization?.startsWith("Bearer ") === true
        ? authorization.slice("Bearer ".length).trim()
        : "";
    const invocation = yield* McpSessionRegistry.resolveActiveMcpCredential(bearer);
    if (!invocation) {
      yield* Effect.logWarning("rejected app MCP proxy request with an unusable credential");
      return unauthorized;
    }
    const params = yield* HttpRouter.params;
    const rawId = params.connectionId ?? "";
    if (rawId.length === 0) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    const connectionId = AppConnectionId.make(rawId);
    const method = request.method;
    if (method !== "POST" && method !== "GET" && method !== "DELETE") {
      return HttpServerResponse.text("Method Not Allowed", { status: 405 });
    }
    let body: Uint8Array | undefined;
    if (method === "POST") {
      const rawBody = yield* request.arrayBuffer.pipe(Effect.result);
      if (Result.isFailure(rawBody)) {
        return HttpServerResponse.text("Bad Request", { status: 400 });
      }
      body = new Uint8Array(rawBody.success);
    }
    const forwardedHeaders: Record<string, string> = {};
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers[name];
      if (typeof value === "string" && value.length > 0) forwardedHeaders[name] = value;
    }

    const attempt = (forceRefresh: boolean) =>
      Effect.gen(function* () {
        const target = yield* apps.resolveUpstream(connectionId, { forceRefresh });
        const upstreamRequest = HttpClientRequest.make(method)(target.url).pipe(
          HttpClientRequest.setHeaders({ ...forwardedHeaders, ...target.headers }),
          body !== undefined
            ? HttpClientRequest.bodyUint8Array(
                body,
                forwardedHeaders["content-type"] ?? "application/json",
              )
            : (request) => request,
        );
        return yield* httpClient.execute(upstreamRequest);
      });

    const first = yield* attempt(false).pipe(Effect.result);
    if (Result.isFailure(first)) {
      const error = first.failure;
      yield* Effect.logWarning("app MCP proxy request failed", {
        connectionId,
        error: error._tag === "AppsError" ? error.message : String(error),
      });
      if (error._tag === "AppsError") {
        yield* apps.recordError(connectionId, error.message);
        return HttpServerResponse.jsonUnsafe(
          { error: "app_unavailable", message: error.message },
          { status: 503, headers: { "cache-control": "no-store" } },
        );
      }
      return HttpServerResponse.jsonUnsafe(
        { error: "upstream_unreachable", message: "Could not reach the app's MCP server." },
        { status: 502, headers: { "cache-control": "no-store" } },
      );
    }

    let response = first.success;
    if (response.status === 401) {
      // Token revoked or expired early upstream: refresh once, then give up.
      const retried = yield* attempt(true).pipe(Effect.result);
      if (Result.isSuccess(retried)) {
        response = retried.success;
      }
      if (response.status === 401) {
        yield* apps.recordError(
          connectionId,
          "The app rejected its credential. Reconnect it in Settings → Apps.",
        );
      }
    }

    const responseHeaders: Record<string, string> = { "cache-control": "no-store" };
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = response.headers[name];
      if (typeof value === "string" && value.length > 0) responseHeaders[name] = value;
    }
    return HttpServerResponse.stream(response.stream, {
      status: response.status,
      headers: responseHeaders,
    });
  }),
);

export const layer = Layer.mergeAll(callbackRoute, proxyRoute);
