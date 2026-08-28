import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";

import { buildRelayMeshRegistrations, isRelayEnvironmentMissing } from "./connectMesh";

describe("buildRelayMeshRegistrations", () => {
  it("builds a deterministic catalog without the local environment", () => {
    const primaryEnvironmentId = EnvironmentId.make("environment-primary");
    const registrations = buildRelayMeshRegistrations(
      [
        { environmentId: EnvironmentId.make("environment-z"), label: "Z machine" },
        { environmentId: primaryEnvironmentId, label: "This machine" },
        { environmentId: EnvironmentId.make("environment-a"), label: "A machine" },
      ].map((environment) => ({
        environment: {
          ...environment,
          endpoint: {
            httpBaseUrl: `https://${environment.environmentId}.example.test`,
            wsBaseUrl: `wss://${environment.environmentId}.example.test`,
            providerKind: "cloudflare_tunnel" as const,
          },
          linkedAt: "2026-08-11T00:00:00.000Z",
        },
        availability: "online" as const,
        status: Option.none(),
        error: Option.none(),
      })),
      primaryEnvironmentId,
    );

    expect(registrations.map(({ target }) => [target.environmentId, target.label])).toEqual([
      ["environment-a", "A machine"],
      ["environment-z", "Z machine"],
    ]);
  });
});

describe("isRelayEnvironmentMissing", () => {
  const environmentId = EnvironmentId.make("environment-primary");

  it("detects a locally linked environment missing from an authoritative account list", () => {
    expect(
      isRelayEnvironmentMissing(
        {
          environments: new Map(),
          loaded: true,
          refreshing: false,
          offline: false,
          error: Option.none(),
        },
        environmentId,
      ),
    ).toBe(true);
  });

  it("does not treat incomplete or failed discovery as an account removal", () => {
    const base = {
      environments: new Map(),
      loaded: true,
      refreshing: false,
      offline: false,
      error: Option.none(),
    };

    expect(isRelayEnvironmentMissing({ ...base, loaded: false }, environmentId)).toBe(false);
    expect(isRelayEnvironmentMissing({ ...base, refreshing: true }, environmentId)).toBe(false);
    expect(isRelayEnvironmentMissing({ ...base, offline: true }, environmentId)).toBe(false);
    expect(
      isRelayEnvironmentMissing(
        { ...base, error: Option.some(new Error("relay unavailable") as never) },
        environmentId,
      ),
    ).toBe(false);
  });
});
