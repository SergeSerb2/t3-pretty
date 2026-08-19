import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { AppConnectionId, type AppConnectionInput } from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AppsService from "./AppsService.ts";

const textDecoder = new TextDecoder();

/** Everything the fake upstream saw, for assertions. */
interface Recorded {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * One fake host playing MCP server (`mcp.acme.test`) and authorization server
 * (`auth.acme.test`): RFC 9728 challenge → PRM → AS metadata → DCR → token.
 */
function makeFakeUpstream() {
  const recorded: Recorded[] = [];
  let accessTokenCounter = 0;
  const client = HttpClient.make((request, url) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === "string") headers[key] = value;
    }
    const body = request.body._tag === "Uint8Array" ? textDecoder.decode(request.body.body) : "";
    recorded.push({ method: request.method, url: url.toString(), headers, body });
    const respond = (status: number, payload: unknown, extra?: Record<string, string>) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(payload === undefined ? null : JSON.stringify(payload), {
            status,
            headers: { "content-type": "application/json", ...extra },
          }),
        ),
      );
    const path = `${url.host}${url.pathname}`;
    if (path === "mcp.acme.test/mcp") {
      const auth = headers.authorization;
      if (auth !== `Bearer at-${accessTokenCounter}` && auth !== "Bearer static-token") {
        return respond(401, undefined, {
          "www-authenticate":
            'Bearer resource_metadata="https://mcp.acme.test/.well-known/oauth-protected-resource/mcp"',
        });
      }
      const parsed = JSON.parse(body) as { id?: number; method: string };
      if (parsed.method === "initialize") {
        return respond(
          200,
          {
            jsonrpc: "2.0",
            id: parsed.id,
            result: { protocolVersion: "2025-06-18", serverInfo: { name: "Acme" } },
          },
          { "mcp-session-id": "sess-1" },
        );
      }
      if (parsed.method === "tools/list") {
        expect(headers["mcp-session-id"]).toBe("sess-1");
        return respond(200, {
          jsonrpc: "2.0",
          id: parsed.id,
          result: { tools: [{ name: "list_widgets", description: "Lists widgets" }] },
        });
      }
      return respond(202, undefined);
    }
    if (path === "mcp.acme.test/.well-known/oauth-protected-resource/mcp") {
      return respond(200, {
        resource: "https://mcp.acme.test/mcp",
        authorization_servers: ["https://auth.acme.test"],
        scopes_supported: ["read", "write"],
      });
    }
    if (path === "auth.acme.test/.well-known/oauth-authorization-server") {
      return respond(200, {
        issuer: "https://auth.acme.test",
        authorization_endpoint: "https://auth.acme.test/authorize",
        token_endpoint: "https://auth.acme.test/token",
        registration_endpoint: "https://auth.acme.test/register",
      });
    }
    if (path === "auth.acme.test/register") {
      return respond(201, { client_id: "dcr-client" });
    }
    if (path === "auth.acme.test/token") {
      const params = new URLSearchParams(body);
      accessTokenCounter += 1;
      if (params.get("grant_type") === "authorization_code") {
        expect(params.get("code")).toBe("code-1");
        expect(params.get("client_id")).toBe("dcr-client");
        expect(params.get("code_verifier")?.length).toBeGreaterThan(20);
        expect(params.get("resource")).toBe("https://mcp.acme.test/mcp");
      } else {
        expect(params.get("grant_type")).toBe("refresh_token");
        expect(params.get("refresh_token")).toBe("rt-1");
      }
      return respond(200, {
        access_token: `at-${accessTokenCounter}`,
        refresh_token: "rt-1",
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    return respond(404, { error: "unknown" });
  });
  return { client, recorded };
}

const memorySecretStore = () => {
  const store = new Map<string, Uint8Array>();
  return Layer.succeed(
    ServerSecretStore.ServerSecretStore,
    ServerSecretStore.ServerSecretStore.of({
      get: (name) => Effect.sync(() => Option.fromNullishOr(store.get(name))),
      set: (name, value) => Effect.sync(() => void store.set(name, value)),
      create: (name, value) => Effect.sync(() => void store.set(name, value)),
      getOrCreateRandom: (name) =>
        Effect.sync(() => {
          const existing = store.get(name);
          if (existing) return existing;
          const created = new Uint8Array(8);
          store.set(name, created);
          return created;
        }),
      remove: (name) => Effect.sync(() => void store.delete(name)),
    }),
  );
};

const makeTestLayer = (client: HttpClient.HttpClient) =>
  AppsService.layer.pipe(
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provide(memorySecretStore()),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(TestClock.layer()),
  );

const oauthApp: AppConnectionInput = {
  id: AppConnectionId.make("conn-acme"),
  catalogId: null,
  name: "Acme",
  slug: "acme",
  url: "https://mcp.acme.test/mcp",
  auth: "oauth",
  scopes: "",
  tokenHeader: "Authorization",
  enabled: true,
};

const oauthFlowUpstream = makeFakeUpstream();

it.effect("runs the OAuth flow end to end: discover, register, authorize, exchange, refresh", () =>
  Effect.gen(function* () {
    const { recorded } = oauthFlowUpstream;
    const apps = yield* AppsService.AppsService;
    const settings = yield* ServerSettings.ServerSettingsService;

    yield* apps.upsert(oauthApp);
    const { authorizationUrl } = yield* apps.authorize({
      connectionId: oauthApp.id,
      callbackOrigin: "http://127.0.0.1:4321",
    });
    const url = new URL(authorizationUrl);
    expect(url.origin + url.pathname).toBe("https://auth.acme.test/authorize");
    expect(url.searchParams.get("client_id")).toBe("dcr-client");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://127.0.0.1:4321/api/apps/oauth/callback",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("read write");
    expect(url.searchParams.get("resource")).toBe("https://mcp.acme.test/mcp");
    const registration = recorded.find((entry) => entry.url.endsWith("/register"));
    expect(JSON.parse(registration!.body).redirect_uris).toEqual([
      "http://127.0.0.1:4321/api/apps/oauth/callback",
    ]);

    const rejected = yield* apps.completeCallback({
      state: "bogus",
      code: "code-1",
      error: null,
      errorDescription: null,
    });
    expect(rejected.ok).toBe(false);

    const outcome = yield* apps.completeCallback({
      state: url.searchParams.get("state"),
      code: "code-1",
      error: null,
      errorDescription: null,
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.connectionName).toBe("Acme");
    const stored = (yield* settings.getSettings).apps.connections[oauthApp.id];
    expect(stored?.authorizedAt).not.toBeNull();
    expect(stored?.lastError).toBeNull();

    const target = yield* apps.resolveUpstream(oauthApp.id);
    expect(target).toEqual({
      url: "https://mcp.acme.test/mcp",
      headers: { authorization: "Bearer at-1" },
    });

    // Inside the expiry window nothing is refreshed; past it the refresh token is used once.
    yield* TestClock.adjust(Duration.minutes(30));
    expect((yield* apps.resolveUpstream(oauthApp.id)).headers.authorization).toBe("Bearer at-1");
    yield* TestClock.adjust(Duration.minutes(31));
    expect((yield* apps.resolveUpstream(oauthApp.id)).headers.authorization).toBe("Bearer at-2");
    expect(
      recorded.filter((entry) => entry.body.includes("grant_type=refresh_token")),
    ).toHaveLength(1);

    const tested = yield* apps.test(oauthApp.id);
    expect(tested.serverName).toBe("Acme");
    expect(tested.tools).toEqual([{ name: "list_widgets", description: "Lists widgets" }]);

    yield* apps.disconnect(oauthApp.id);
    expect((yield* settings.getSettings).apps.connections[oauthApp.id]?.authorizedAt).toBeNull();
    const failure = yield* Effect.flip(apps.resolveUpstream(oauthApp.id));
    expect(failure.message).toContain("not connected");
  }).pipe(Effect.provide(makeTestLayer(oauthFlowUpstream.client))),
);

it.effect("stores static tokens, honors custom headers, and refuses disabled apps", () =>
  Effect.gen(function* () {
    const apps = yield* AppsService.AppsService;
    const tokenApp: AppConnectionInput = {
      ...oauthApp,
      id: AppConnectionId.make("conn-token"),
      slug: "acme-token",
      auth: "token",
      tokenHeader: "X-Api-Key",
    };
    yield* apps.upsert(tokenApp);
    yield* apps.setToken({ connectionId: tokenApp.id, token: "static-token" });
    expect(yield* apps.resolveUpstream(tokenApp.id)).toEqual({
      url: "https://mcp.acme.test/mcp",
      headers: { "x-api-key": "static-token" },
    });

    yield* apps.upsert({ ...tokenApp, enabled: false });
    const off = yield* Effect.flip(apps.resolveUpstream(tokenApp.id));
    expect(off.message).toContain("turned off");
    // The credential survives a toggle; only auth/url changes drop it.
    expect(
      (yield* apps.resolveUpstream(tokenApp.id, { requireEnabled: false })).headers["x-api-key"],
    ).toBe("static-token");

    const duplicate = yield* Effect.flip(
      apps.upsert({ ...oauthApp, id: AppConnectionId.make("conn-dup"), slug: "acme-token" }),
    );
    expect(duplicate.message).toContain("@acme-token");

    yield* apps.remove(tokenApp.id);
    const gone = yield* Effect.flip(apps.resolveUpstream(tokenApp.id));
    expect(gone.message).toContain("Unknown app");
  }).pipe(Effect.provide(makeTestLayer(makeFakeUpstream().client))),
);

it.effect("requires a configured client for families without dynamic registration", () =>
  Effect.gen(function* () {
    const apps = yield* AppsService.AppsService;
    const settings = yield* ServerSettings.ServerSettingsService;
    const gmail: AppConnectionInput = {
      ...oauthApp,
      id: AppConnectionId.make("conn-gmail"),
      catalogId: "gmail",
      slug: "gmail",
      url: "https://mcp.acme.test/mcp",
    };
    yield* apps.upsert(gmail);
    const blocked = yield* Effect.flip(
      apps.authorize({ connectionId: gmail.id, callbackOrigin: "http://127.0.0.1:4321" }),
    );
    expect(blocked.message).toContain("Google Cloud OAuth client");

    yield* apps.setOAuthClient({ family: "google", clientId: "cid", clientSecret: "shh" });
    expect((yield* settings.getSettings).apps.oauthClients.google).toEqual({
      clientId: "cid",
      hasClientSecret: true,
    });
    const { authorizationUrl } = yield* apps.authorize({
      connectionId: gmail.id,
      callbackOrigin: "http://127.0.0.1:4321",
    });
    const url = new URL(authorizationUrl);
    expect(url.searchParams.get("client_id")).toBe("cid");
    // Catalog defaults: Gmail scope and Google's offline-access params.
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.modify");
    expect(url.searchParams.get("access_type")).toBe("offline");

    yield* apps.setOAuthClient({ family: "google", clientId: "" });
    expect((yield* settings.getSettings).apps.oauthClients.google).toBeUndefined();
  }).pipe(Effect.provide(makeTestLayer(makeFakeUpstream().client))),
);
