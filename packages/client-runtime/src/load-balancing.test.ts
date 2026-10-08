import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, type HostResourcesSnapshot } from "@t3tools/contracts";
import { Atom, AsyncResult, AtomRegistry } from "effect/reactivity";
import {
  chooseLoadBalancedEnvironment,
  createLoadBalancingResourcesAtom,
  shouldAutoBalanceDraft,
} from "./load-balancing.ts";

const now = 100_000;
const resources: HostResourcesSnapshot = {
  sampledAt: now,
  cpuCount: 8,
  cpuUtilization: 0.25,
  availableMemoryBytes: 12_000,
  totalMemoryBytes: 16_000,
};

describe("resource-based machine selection", () => {
  it("chooses available capacity instead of the first machine", () => {
    expect(
      chooseLoadBalancedEnvironment(
        [
          { environmentId: "busy", resources: { ...resources, cpuUtilization: 0.9 }, weight: 50 },
          { environmentId: "free", resources, weight: 50 },
        ],
        now,
      ),
    ).toBe("free");
  });

  it("honors preferences and excludes manual-only machines", () => {
    const candidates = [
      { environmentId: "normal", resources, weight: 50 },
      { environmentId: "preferred", resources: { ...resources, cpuUtilization: 0.5 }, weight: 100 },
      { environmentId: "manual", resources: { ...resources, cpuCount: 64 }, weight: 0 },
    ];
    expect(chooseLoadBalancedEnvironment(candidates, now)).toBe("preferred");
    expect(
      chooseLoadBalancedEnvironment(
        candidates.map((candidate) => ({
          ...candidate,
          weight: candidate.environmentId === "preferred" ? 25 : candidate.weight,
        })),
        now,
      ),
    ).toBe("normal");
  });

  it("favors more available memory when CPU capacity and memory pressure are equal", () => {
    expect(
      chooseLoadBalancedEnvironment(
        [
          { environmentId: "small", resources, weight: 50 },
          {
            environmentId: "large",
            resources: { ...resources, totalMemoryBytes: 64_000, availableMemoryBytes: 48_000 },
            weight: 50,
          },
        ],
        now,
      ),
    ).toBe("large");
  });

  it("requires recent usable measurements and avoids saturated hosts", () => {
    expect(
      chooseLoadBalancedEnvironment(
        [
          {
            environmentId: "stale",
            resources: { ...resources, sampledAt: now - 15_001 },
            weight: 100,
          },
          { environmentId: "busy", resources: { ...resources, cpuUtilization: 0.95 }, weight: 100 },
          {
            environmentId: "low-memory",
            resources: { ...resources, availableMemoryBytes: 800 },
            weight: 100,
          },
          { environmentId: "missing", resources: null, weight: 100 },
        ],
        now,
      ),
    ).toBeNull();
  });

  it("uses receipt time when machine clocks differ", () => {
    expect(
      chooseLoadBalancedEnvironment(
        [
          {
            environmentId: "remote",
            resources: { ...resources, sampledAt: now + 60_000 },
            receivedAt: now,
            weight: 50,
          },
        ],
        now,
      ),
    ).toBe("remote");
  });

  it("subscribes only to candidate hosts and waits for their measurements", () => {
    const environmentId = EnvironmentId.make("remote");
    const host = Atom.make<AsyncResult.AsyncResult<HostResourcesSnapshot, unknown>>(
      AsyncResult.initial(),
    );
    const requested: EnvironmentId[] = [];
    const query = createLoadBalancingResourcesAtom([environmentId], (input) => {
      requested.push(input.environmentId);
      return host;
    });
    const registry = AtomRegistry.make();
    const unmount = registry.mount(query);
    try {
      expect(registry.get(query)[0]).toMatchObject({ pending: true, resources: null });
      registry.set(host, AsyncResult.success(resources));
      const result = registry.get(query)[0]!;
      expect(result.pending).toBe(false);
      expect(result.resources).toEqual(resources);
      expect(result.receivedAt).toBeGreaterThan(0);
      expect(new Set(requested)).toEqual(new Set([environmentId]));
      const idle = createLoadBalancingResourcesAtom([], () => {
        throw new Error("Idle client requested resources");
      });
      expect(registry.get(idle)).toEqual([]);
    } finally {
      unmount();
      registry.dispose();
    }
  });
});

describe("automatic draft routing", () => {
  const draft = {
    enabled: true,
    selection: undefined,
    hasAttachments: false,
    assignedEnvironmentId: undefined,
    branch: null,
    worktreePath: null,
  } as const;

  it("routes fresh drafts and preserves an explicit machine choice", () => {
    expect(shouldAutoBalanceDraft(draft)).toBe(true);
    expect(shouldAutoBalanceDraft({ ...draft, selection: "manual" })).toBe(false);
    expect(shouldAutoBalanceDraft({ ...draft, enabled: false })).toBe(false);
  });

  it("pins branch, worktree, and attachment choices to their machine", () => {
    expect(shouldAutoBalanceDraft({ ...draft, branch: "feature" })).toBe(false);
    expect(shouldAutoBalanceDraft({ ...draft, worktreePath: "/repo/worktree" })).toBe(false);
    expect(shouldAutoBalanceDraft({ ...draft, hasAttachments: true })).toBe(false);
    expect(
      shouldAutoBalanceDraft({
        ...draft,
        selection: "auto",
        branch: "main",
        assignedEnvironmentId: "remote",
      }),
    ).toBe(true);
  });
});
