import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Option from "effect/Option";

import {
  buildRelayMeshRegistrations,
  hasObservedRelayMembership,
  isRelayEnvironmentMissing,
  isRelayEnvironmentPresent,
  rememberRelayMembership,
  shouldRepairStoredCloudLink,
} from "./connectMesh";

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

  it("only reports presence after an authoritative account list", () => {
    const environment = {
      environmentId,
      label: "Local Mac",
      endpoint: {
        httpBaseUrl: "https://local.example.test",
        wsBaseUrl: "wss://local.example.test",
        providerKind: "cloudflare_tunnel" as const,
      },
      linkedAt: "2026-08-27T00:00:00.000Z",
    };
    const base = {
      environments: new Map([
        [
          environmentId,
          {
            environment,
            availability: "online" as const,
            status: Option.none(),
            error: Option.none(),
          },
        ],
      ]),
      loaded: true,
      refreshing: false,
      offline: false,
      error: Option.none(),
    };

    expect(isRelayEnvironmentPresent(base, environmentId)).toBe(true);
    expect(isRelayEnvironmentPresent({ ...base, refreshing: true }, environmentId)).toBe(false);
  });
});

describe("stored cloud link repair", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("repairs only foreign links or a never-observed missing membership", () => {
    expect(
      shouldRepairStoredCloudLink({
        linked: false,
        relayMembershipMissing: false,
        relayMembershipObserved: true,
      }),
    ).toBe(true);
    expect(
      shouldRepairStoredCloudLink({
        linked: true,
        relayMembershipMissing: true,
        relayMembershipObserved: false,
      }),
    ).toBe(true);
    expect(
      shouldRepairStoredCloudLink({
        linked: true,
        relayMembershipMissing: true,
        relayMembershipObserved: true,
      }),
    ).toBe(false);
  });

  it("remembers observed membership without depending on writable browser storage", () => {
    const environmentId = EnvironmentId.make("environment-primary");
    const values = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => void values.set(key, value));
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem,
    });

    expect(hasObservedRelayMembership(environmentId)).toBe(false);
    rememberRelayMembership(environmentId);
    rememberRelayMembership(environmentId);
    expect(hasObservedRelayMembership(environmentId)).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(1);

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    });
    expect(hasObservedRelayMembership(environmentId)).toBe(false);
    expect(() => rememberRelayMembership(environmentId)).not.toThrow();
  });
});
