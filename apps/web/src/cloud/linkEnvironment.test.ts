import {
  type DesktopBridge,
  EnvironmentId,
  type RelayClientInstallProgressEvent,
  WS_METHODS,
} from "@t3tools/contracts";
import { RelayWebClientId } from "@t3tools/contracts/relay";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient } from "effect/unstable/http";
import { afterEach, beforeEach, vi } from "vite-plus/test";
import {
  AVAILABLE_CONNECTION_STATE,
  EnvironmentSupervisor,
  type PreparedConnection,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { type RpcSession } from "@t3tools/client-runtime/rpc";
import { EnvironmentRegistry } from "@t3tools/client-runtime/connection";
import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import { __resetDesktopPrimaryAuthForTests } from "../environments/primary/desktopAuth";

import {
  collectCloudLinkTargets,
  findEnvironmentCloudApiError,
  isCloudLinkOnConfiguredRelay,
  isCloudLinkOnConfiguredRelayForAccount,
  it.effect("reads primary cloud link state from the explicit target", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          linked: true,
          cloudUserId: "user-1",
          relayUrl: "https://relay.example.test",
          relayIssuer: "https://relay.example.test",
          managedTunnelActive: true,
          publishAgentActivity: false,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const state = yield* withServices(readPrimaryCloudLinkState({ target: TARGET }));

      expect(Option.fromNullishOr(state)).toEqual(
        Option.some({
          linked: true,
          cloudUserId: "user-1",
          relayUrl: "https://relay.example.test",
          relayIssuer: "https://relay.example.test",
          managedTunnelActive: true,
          publishAgentActivity: false,
        }),
      );
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "http://127.0.0.1:3000/api/connect/link-state",
      );
    }),
  );

  it.effect("uses desktop bearer auth for primary cloud link state", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          linked: true,
          cloudUserId: "user-1",
          relayUrl: "https://relay.example.test",
          relayIssuer: "https://relay.example.test",
          managedTunnelActive: true,
          publishAgentActivity: false,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);
      vi.stubGlobal("window", {
        location: { origin: "t3code://app" },
        desktopBridge: {
          getLocalEnvironmentBearerToken: vi.fn().mockResolvedValue("desktop-bearer-token"),
        } as unknown as DesktopBridge,
      });

      yield* withServices(readPrimaryCloudLinkState({ target: TARGET }));

      const request = new Request(fetchMock.mock.calls[0]?.[0], fetchMock.mock.calls[0]?.[1]);
      expect(request.credentials).not.toBe("include");
      expect(request.headers.get("authorization")).toBe("Bearer desktop-bearer-token");
    }),
  );

  it.effect("updates agent activity publishing for the explicit primary target", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          linked: true,
          cloudUserId: "user-1",
          relayUrl: "https://relay.example.test",
          relayIssuer: "https://relay.example.test",
          managedTunnelActive: true,
          publishAgentActivity: true,
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const state = yield* withServices(
        updatePrimaryCloudPreferences({
          target: TARGET,
          publishAgentActivity: true,
        }),
      );

      expect(state.publishAgentActivity).toBe(true);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "http://127.0.0.1:3000/api/connect/preferences",
      );
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      expect(JSON.parse(bodyText(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
        publishAgentActivity: true,
      });
    }),
  );

  it.effect("links a browser primary without sending its cookie credentials to the relay", () =>
    Effect.gen(function* () {
      vi.stubGlobal("window", {
        location: { origin: TARGET.httpBaseUrl, href: `${TARGET.httpBaseUrl}/settings` },
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            challenge: "challenge",
            expiresAt: "2026-06-06T00:05:00.000Z",
          }),
        )
        .mockResolvedValueOnce(Response.json("signed-proof"))
        .mockResolvedValueOnce(
          Response.json({
            ok: true,
            environmentId: TARGET.environmentId,
            endpoint: {
              httpBaseUrl: "https://desktop.example.test",
              wsBaseUrl: "wss://desktop.example.test",
              providerKind: "cloudflare_tunnel",
            },
            endpointRuntime: null,
            relayIssuer: "https://relay.example.test",
            cloudUserId: "user-1",
            environmentCredential: "environment-credential",
            cloudMintPublicKey: "public-key",
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ ok: true, endpointRuntimeStatus: { status: "disabled" } }),
        );
      vi.stubGlobal("fetch", fetchMock);

      yield* withServices(
        linkPrimaryEnvironmentToCloud({
          target: TARGET,
          clerkToken: "clerk-token",
        }),
      );

      expect(relayClientInstallDialog.requestConfirmation).not.toHaveBeenCalled();
      for (const [input, init] of fetchMock.mock.calls) {
        const request = new Request(input, init);
        if (request.url.startsWith(TARGET.httpBaseUrl)) {
          expect(request.credentials).toBe("include");
        } else {
          expect(request.credentials).not.toBe("include");
          expect(request.headers.get("authorization")).toBe("Bearer clerk-token");
        }
      }
      expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
        "http://127.0.0.1:3000/api/connect/link-proof",
      );
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      expect(JSON.parse(bodyText(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
        challenge: "challenge",
        endpoint: {
          httpBaseUrl: TARGET.httpBaseUrl,
          wsBaseUrl: TARGET.wsBaseUrl,
        },
      });
    }),
  );

  it.effect("links publish-only without a managed tunnel", () =>
    Effect.gen(function* () {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            challenge: "challenge",
            expiresAt: "2026-06-06T00:05:00.000Z",
          }),
        )
        .mockResolvedValueOnce(Response.json("signed-proof"))
        .mockResolvedValueOnce(
          Response.json({
            ok: true,
            environmentId: TARGET.environmentId,
            endpoint: {
              httpBaseUrl: TARGET.httpBaseUrl,
              wsBaseUrl: TARGET.wsBaseUrl,
              providerKind: "manual",
            },
            endpointRuntime: null,
            relayIssuer: "https://relay.example.test",
            cloudUserId: "user-1",
            environmentCredential: "environment-credential",
            cloudMintPublicKey: "public-key",
          }),
        )
        .mockResolvedValueOnce(
          Response.json({ ok: true, endpointRuntimeStatus: { status: "disabled" } }),
        );
      vi.stubGlobal("fetch", fetchMock);

      yield* withServices(
        linkPrimaryEnvironmentToCloud({
          target: TARGET,
          clerkToken: "clerk-token",
          mode: "publish_only",
        }),
      );

      // @effect-diagnostics-next-line preferSchemaOverJson:off
      expect(JSON.parse(bodyText(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
        managedTunnelsEnabled: false,
      });
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      expect(JSON.parse(bodyText(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
        endpoint: { providerKind: "manual" },
      });
    }),
  );

  it.effect("installs a missing relay client before linking", () =>
    Effect.gen(function* () {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ malformed: true })));

      yield* withServices(
        linkPrimaryEnvironmentToCloud({
          target: TARGET,
          clerkToken: "clerk-token",
        }),
        {
          status: { status: "available", version: "2026.6.0" },
          installEvents: [],
        },
      ).pipe(Effect.flip);

      expect(relayClientInstallDialog.requestConfirmation).not.toHaveBeenCalled();
    }),
  );

  it.effect("unlinks locally before revoking the relay record", () =>
    Effect.gen(function* () {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ ok: true, endpointRuntimeStatus: { status: "disabled" } }),
        )
        .mockResolvedValueOnce(Response.json({ ok: true }));
      vi.stubGlobal("fetch", fetchMock);

      yield* withServices(
        unlinkPrimaryEnvironmentFromCloud({
          target: TARGET,
          clerkToken: "clerk-token",
        }),
      );

      expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:3000/api/connect/unlink");
      expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
        `/v1/client/environment-links/${TARGET.environmentId}`,
      );
    }),
  );
});
