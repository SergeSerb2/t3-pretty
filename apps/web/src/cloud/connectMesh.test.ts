import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import * as Option from "effect/Option";

import {
  RELAY_MEMBERSHIP_OBSERVED_STORAGE_KEY,
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
        linked: false,
        relayMembershipMissing: true,
        relayMembershipObserved: true,
      }),
    ).toBe(false);
    expect(
      shouldRepairStoredCloudLink({
        linked: true,
        relayMembershipMissing: true,
        relayMembershipObserved: true,
      }),
    ).toBe(false);
  });

  it("remembers observed membership without depending on writable browser storage", () => {
    const firstEnvironmentId = EnvironmentId.make("environment-primary");
    const secondEnvironmentId = EnvironmentId.make("environment-secondary");
    const values = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => void values.set(key, value));
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem,
    });

    expect(hasObservedRelayMembership(firstEnvironmentId)).toBe(false);
    rememberRelayMembership(firstEnvironmentId);
    rememberRelayMembership(secondEnvironmentId);
    rememberRelayMembership(firstEnvironmentId);
    expect(hasObservedRelayMembership(firstEnvironmentId)).toBe(true);
    expect(hasObservedRelayMembership(secondEnvironmentId)).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(JSON.parse(values.get(RELAY_MEMBERSHIP_OBSERVED_STORAGE_KEY) ?? "[]")).toEqual([
      firstEnvironmentId,
      secondEnvironmentId,
    ]);
  });

  it("fails closed and remembers this launch when browser storage is unavailable", () => {
    const unreadableEnvironmentId = EnvironmentId.make("environment-unreadable");
    const rememberedEnvironmentId = EnvironmentId.make("environment-remembered-in-memory");

    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    });
    expect(hasObservedRelayMembership(unreadableEnvironmentId)).toBe(true);
    expect(() => rememberRelayMembership(rememberedEnvironmentId)).not.toThrow();

    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: vi.fn(),
    });
    expect(hasObservedRelayMembership(unreadableEnvironmentId)).toBe(true);
    expect(hasObservedRelayMembership(rememberedEnvironmentId)).toBe(true);
  });
});
