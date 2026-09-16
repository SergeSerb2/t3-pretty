/**
 * Leftover `providerInstances.kimi` entries must not construct KimiDriver
 * or call makeKimiEnvironment. That crash looped the Mac nightly backend
 * before desktop readiness.
 */
import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProviderDriverKind,
  type ProviderInstanceConfigMap,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as BackgroundPolicy from "../../background/BackgroundPolicy.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { CodexDriver } from "../Drivers/CodexDriver.ts";
import { BUILT_IN_DRIVERS } from "../builtInDrivers.ts";
import * as ModelManifest from "../ModelManifest.ts";
import * as CodexResetCredit from "./codexResetCredit.ts";
import { NoOpProviderEventLoggers, ProviderEventLoggers } from "./ProviderEventLoggers.ts";
import { makeProviderInstanceRegistry } from "./ProviderInstanceRegistryLive.ts";

const TestHttpClientLive = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({ version: "0.0.0" }))),
  ),
);

const TEST_EPOCH = DateTime.makeUnsafe("1970-01-01T00:00:00.000Z");

const BackgroundPolicyAlwaysRunLayer = Layer.mock(BackgroundPolicy.BackgroundPolicy)({
  reportClientActivity: () => Effect.void,
  removeRpcClient: () => Effect.void,
  reportHostPowerState: () => Effect.void,
  snapshot: Effect.succeed({
    hostPower: {
      source: "unknown",
      idle: "unknown",
      idleSeconds: null,
      locked: "unknown",
      suspended: false,
      onBattery: "unknown",
      lowPowerMode: "unknown",
      thermalState: "unknown",
      stale: true,
      updatedAt: TEST_EPOCH,
    },
    leases: [],
    activeForegroundLeaseCount: 0,
    activeScopeKeys: [],
    shouldRunOpportunisticWork: true,
    updatedAt: TEST_EPOCH,
  }),
  streamChanges: Stream.empty,
  hasDemand: () => Effect.succeed(true),
  shouldRunScopeWork: () => Effect.succeed(true),
  shouldRunOpportunisticWork: Effect.succeed(true),
});

const leftoverKimiLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "provider-instance-registry-kimi-removal-test",
}).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(BackgroundPolicyAlwaysRunLayer),
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(TestHttpClientLive),
  Layer.provideMerge(Layer.succeed(ProviderEventLoggers, NoOpProviderEventLoggers)),
  Layer.provideMerge(ModelManifest.layerTest),
  Layer.provideMerge(CodexResetCredit.layerTest),
);

describe("ProviderInstanceRegistryLive — Kimi removal", () => {
  it.live("does not register a Kimi driver and shadows leftover Kimi config", () =>
    Effect.gen(function* () {
      expect(BUILT_IN_DRIVERS.map((driver) => driver.driverKind)).not.toContain("kimi");

      const kimiId = ProviderInstanceId.make("kimi");
      const configMap: ProviderInstanceConfigMap = {
        [kimiId]: {
          driver: ProviderDriverKind.make("kimi"),
          displayName: "Kimi",
          enabled: true,
          config: {},
        },
      };

      const { registry } = yield* makeProviderInstanceRegistry({
        drivers: [CodexDriver],
        configMap,
      });

      expect(yield* registry.listInstances).toEqual([]);
      const unavailable = yield* registry.listUnavailable;
      expect(unavailable).toHaveLength(1);
      expect(unavailable[0]).toMatchObject({
        instanceId: kimiId,
        driver: "kimi",
        availability: "unavailable",
      });
      expect(unavailable[0]!.unavailableReason).toMatch(/kimi/i);
    }).pipe(Effect.provide(leftoverKimiLayer)),
  );
});
