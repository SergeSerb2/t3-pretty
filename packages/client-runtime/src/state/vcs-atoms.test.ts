import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import type { EnvironmentCacheStore } from "../platform/persistence.ts";
import { createVcsEnvironmentAtoms, VCS_STATUS_IDLE_TTL_MS } from "./vcs.ts";

describe("VCS environment atoms", () => {
  it("releases an idle status subscription before the generic subscription TTL", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry | EnvironmentCacheStore,
      never
    >;
    const atoms = createVcsEnvironmentAtoms(runtime);

    expect(
      atoms.status({
        environmentId: EnvironmentId.make("environment-1"),
        input: { cwd: "/repo" },
      }).idleTTL,
    ).toBe(VCS_STATUS_IDLE_TTL_MS);
  });
});
