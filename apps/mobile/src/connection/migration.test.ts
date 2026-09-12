import { describe, expect, it } from "@effect/vitest";
import { CONNECTION_CATALOG_MAX_RECORDS_PER_KIND } from "@t3tools/client-runtime/platform";
import { CONNECTION_LABEL_MAX_LENGTH } from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { migrateLegacyConnectionCatalog } from "./migration";

describe("migrateLegacyConnectionCatalog", () => {
  it.effect("migrates bearer and relay-managed connections into the new catalog", () =>
    Effect.gen(function* () {
      const bearerEnvironmentId = EnvironmentId.make("bearer-environment");
      const relayEnvironmentId = EnvironmentId.make("relay-environment");
      const catalog = yield* migrateLegacyConnectionCatalog(
        JSON.stringify({
          connections: [
            {
              environmentId: bearerEnvironmentId,
              environmentLabel: "Local Mac",
              pairingUrl: "https://local.example.test/pair",
              displayUrl: "https://local.example.test",
              httpBaseUrl: "https://local.example.test",
              wsBaseUrl: "wss://local.example.test",
              bearerToken: "bearer-token",
              authenticationMethod: "bearer",
            },
            {
              environmentId: relayEnvironmentId,
              environmentLabel: "Cloud Mac",
              pairingUrl: "https://relay.example.test",
              displayUrl: "https://relay.example.test",
              httpBaseUrl: "https://relay.example.test",
              wsBaseUrl: "wss://relay.example.test",
              bearerToken: null,
              authenticationMethod: "dpop",
              relayManaged: true,
            },
          ],
        }),
      );

      expect(catalog.targets).toHaveLength(2);
      expect(
        catalog.targets.find((target) => target.environmentId === bearerEnvironmentId)?._tag,
      ).toBe("BearerConnectionTarget");
      expect(
        catalog.targets.find((target) => target.environmentId === relayEnvironmentId)?._tag,
      ).toBe("RelayConnectionTarget");
      expect(catalog.profiles).toHaveLength(1);
      expect(catalog.credentials).toHaveLength(1);
      expect(catalog.credentials[0]?.credential).toMatchObject({
        _tag: "BearerConnectionCredential",
        token: "bearer-token",
      });
    }),
  );

  it.effect("drops invalid legacy bearer entries without credentials", () =>
    Effect.gen(function* () {
      const catalog = yield* migrateLegacyConnectionCatalog(
        JSON.stringify({
          connections: [
            {
              environmentId: EnvironmentId.make("invalid-bearer"),
              environmentLabel: "Invalid",
              pairingUrl: "https://invalid.example.test/pair",
              displayUrl: "https://invalid.example.test",
              httpBaseUrl: "https://invalid.example.test",
              wsBaseUrl: "wss://invalid.example.test",
              bearerToken: null,
              authenticationMethod: "bearer",
            },
          ],
        }),
      );

      expect(catalog.targets).toEqual([]);
    }),
  );

  it.effect("keeps an oversized legacy catalog within the current storage schema", () =>
    Effect.gen(function* () {
      const connections = Array.from(
        { length: CONNECTION_CATALOG_MAX_RECORDS_PER_KIND + 1 },
        (_, index) => ({
          environmentId: EnvironmentId.make(`environment-${index}`),
          environmentLabel: `Environment ${index}`,
          pairingUrl: `https://example.test/${index}/pair`,
          displayUrl: `https://example.test/${index}`,
          httpBaseUrl: `https://example.test/${index}`,
          wsBaseUrl: `wss://example.test/${index}`,
          bearerToken: `bearer-${index}`,
          authenticationMethod: "bearer" as const,
        }),
      );
      connections.push({
        ...connections[0]!,
        environmentLabel: "Updated first environment",
        bearerToken: "updated-bearer",
      });

      const catalog = yield* migrateLegacyConnectionCatalog(JSON.stringify({ connections }));

      expect(catalog.targets).toHaveLength(CONNECTION_CATALOG_MAX_RECORDS_PER_KIND);
      expect(catalog.profiles).toHaveLength(CONNECTION_CATALOG_MAX_RECORDS_PER_KIND);
      expect(catalog.credentials).toHaveLength(CONNECTION_CATALOG_MAX_RECORDS_PER_KIND);
      expect(
        catalog.targets.some(
          (target) =>
            target.environmentId === `environment-${CONNECTION_CATALOG_MAX_RECORDS_PER_KIND}`,
        ),
      ).toBe(false);
      expect(
        catalog.profiles.find((profile) => profile.connectionId === "bearer:environment-0")?.label,
      ).toBe("Updated first environment");
    }),
  );

  it.effect("drops fields that cannot be re-encoded without losing later valid entries", () =>
    Effect.gen(function* () {
      const catalog = yield* migrateLegacyConnectionCatalog(
        JSON.stringify({
          connections: [
            {
              environmentId: EnvironmentId.make("oversized-label"),
              environmentLabel: "x".repeat(CONNECTION_LABEL_MAX_LENGTH + 1),
              pairingUrl: "https://invalid.example.test/pair",
              displayUrl: "https://invalid.example.test",
              httpBaseUrl: "https://invalid.example.test",
              wsBaseUrl: "wss://invalid.example.test",
              bearerToken: "invalid-token",
              authenticationMethod: "bearer",
            },
            {
              environmentId: EnvironmentId.make("valid-after-invalid"),
              environmentLabel: "Valid",
              pairingUrl: "https://valid.example.test/pair",
              displayUrl: "https://valid.example.test",
              httpBaseUrl: "https://valid.example.test",
              wsBaseUrl: "wss://valid.example.test",
              bearerToken: "valid-token",
              authenticationMethod: "bearer",
            },
          ],
        }),
      );

      expect(catalog.targets.map((target) => target.environmentId)).toEqual([
        "valid-after-invalid",
      ]);
    }),
  );
});
