import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createReviewEnvironmentAtoms, REVIEW_DIFF_PREVIEW_IDLE_TTL_MS } from "./review.ts";

describe("review environment atoms", () => {
  it("releases idle diff previews before the generic query TTL", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry,
      never
    >;
    const atoms = createReviewEnvironmentAtoms(runtime);

    expect(
      atoms.diffPreview({
        environmentId: EnvironmentId.make("environment-1"),
        input: { cwd: "/repo", baseRef: "main", ignoreWhitespace: true },
      }).idleTTL,
    ).toBe(REVIEW_DIFF_PREVIEW_IDLE_TTL_MS);
  });
});
