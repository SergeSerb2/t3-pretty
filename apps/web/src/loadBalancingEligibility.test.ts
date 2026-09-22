import { describe, expect, it } from "vite-plus/test";

import {
  loadBalancedAssignmentIsStale,
  loadBalancingHostVerdict,
  partitionLoadBalancingHosts,
  type LoadBalancingHost,
  type LoadBalancingHostProvider,
  type LoadBalancingModelTarget,
} from "./loadBalancingEligibility";

const FAST_MODEL = "grok-4.7-build-fast";

const grokFastTarget: LoadBalancingModelTarget = {
  instanceId: "grok",
  driver: "grok",
  model: FAST_MODEL,
  customModel: false,
};

function grokProvider(
  overrides: Partial<LoadBalancingHostProvider> = {},
): LoadBalancingHostProvider {
  return {
    instanceId: "grok",
    driver: "grok",
    enabled: true,
    installed: true,
    status: "ready",
    authStatus: "authenticated",
    availability: "available",
    version: "1.0.40",
    models: [{ slug: "grok-4.7" }, { slug: FAST_MODEL }, { slug: "grok-4.6" }],
    ...overrides,
  };
}

function host(
  environmentId: string,
  provider: LoadBalancingHostProvider | null,
  overrides: Partial<LoadBalancingHost> = {},
): LoadBalancingHost {
  return {
    environmentId,
    connected: true,
    weight: 50,
    providers: provider ? [provider] : [],
    ...overrides,
  };
}

describe("loadBalancingHostVerdict", () => {
  it("accepts a settled machine that advertises Grok 4.7 Fast", () => {
    expect(loadBalancingHostVerdict(host("macbook-pro-2", grokProvider()), grokFastTarget)).toBe(
      "eligible",
    );
  });

  it("rejects a settled machine whose catalog dropped Grok 4.7 Fast", () => {
    expect(
      loadBalancingHostVerdict(
        host(
          "linux-box",
          grokProvider({
            models: [{ slug: "grok-4.7" }, { slug: "grok-4.6" }],
          }),
        ),
        grokFastTarget,
      ),
    ).toBe("ineligible");
  });

  it("waits while the probe still only advertises the built-in Grok model", () => {
    expect(
      loadBalancingHostVerdict(
        host(
          "linux-box",
          grokProvider({
            status: "warning",
            authStatus: "unknown",
            version: null,
            models: [{ slug: "grok-build" }],
          }),
        ),
        grokFastTarget,
      ),
    ).toBe("pending");
  });

  it("does not wait on a finished probe that never listed the model", () => {
    expect(
      loadBalancingHostVerdict(
        host(
          "linux-box",
          grokProvider({
            status: "warning",
            version: "1.0.20",
            models: [{ slug: "grok-4.6" }, { slug: "grok-build" }],
          }),
        ),
        grokFastTarget,
      ),
    ).toBe("ineligible");
  });

  it("accepts a custom model the catalog does not list", () => {
    expect(
      loadBalancingHostVerdict(
        host("linux-box", grokProvider({ models: [{ slug: "grok-build" }] })),
        {
          ...grokFastTarget,
          model: "grok-custom",
          customModel: true,
        },
      ),
    ).toBe("eligible");
  });

  it("matches a model advertised only as an alias", () => {
    expect(
      loadBalancingHostVerdict(
        host(
          "macbook-pro-2",
          grokProvider({
            models: [{ slug: "grok-4.7", aliases: [FAST_MODEL] }],
          }),
        ),
        grokFastTarget,
      ),
    ).toBe("eligible");
  });
});

describe("partitionLoadBalancingHosts", () => {
  it("picks only machines that already list the model and does not wait on the rest", () => {
    const partition = partitionLoadBalancingHosts(
      [
        host(
          "linux-box",
          grokProvider({
            status: "warning",
            authStatus: "unknown",
            version: null,
            models: [{ slug: "grok-build" }],
          }),
        ),
        host("macbook-pro-2", grokProvider()),
        host("old-mac", grokProvider({ models: [{ slug: "grok-4.6" }] })),
      ],
      grokFastTarget,
    );

    expect(partition.eligibleEnvironmentIds).toEqual(["macbook-pro-2"]);
    expect(partition.pending).toBe(false);
  });

  it("stays pending when every candidate is still probing", () => {
    const partition = partitionLoadBalancingHosts(
      [
        host(
          "linux-box",
          grokProvider({
            status: "warning",
            authStatus: "unknown",
            version: null,
            models: [{ slug: "grok-build" }],
          }),
        ),
      ],
      grokFastTarget,
    );

    expect(partition.eligibleEnvironmentIds).toEqual([]);
    expect(partition.pending).toBe(true);
  });
});

describe("loadBalancedAssignmentIsStale", () => {
  it("is stale when the assigned machine settled without Grok 4.7 Fast", () => {
    const hosts = [
      host("linux-box", grokProvider({ models: [{ slug: "grok-4.7" }] })),
      host("macbook-pro-2", grokProvider()),
    ];
    expect(loadBalancedAssignmentIsStale("linux-box", hosts, grokFastTarget)).toBe(true);
    expect(loadBalancedAssignmentIsStale("macbook-pro-2", hosts, grokFastTarget)).toBe(false);
  });

  it("keeps an assignment whose probe has not finished", () => {
    const hosts = [
      host(
        "linux-box",
        grokProvider({
          status: "warning",
          authStatus: "unknown",
          version: null,
          models: [{ slug: "grok-build" }],
        }),
      ),
    ];
    expect(loadBalancedAssignmentIsStale("linux-box", hosts, grokFastTarget)).toBe(false);
  });
});
