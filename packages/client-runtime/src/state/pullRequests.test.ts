import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createPullRequestEnvironmentAtoms,
  PULL_REQUEST_LARGE_QUERY_IDLE_TTL_MS,
} from "./pullRequests.ts";
import type { PullRequestDiffLoader } from "./pullRequestDiffHttp.ts";

describe("pull-request environment atoms", () => {
  it("releases idle conversation and diff payloads before the generic query TTL", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry | PullRequestDiffLoader,
      never
    >;
    const atoms = createPullRequestEnvironmentAtoms(runtime);
    const environmentId = EnvironmentId.make("environment-1");
    const reference = {
      projectId: ProjectId.make("project-1"),
      repository: "acme/repository",
      number: 42,
    };

    expect(atoms.activity({ environmentId, input: reference }).idleTTL).toBe(
      PULL_REQUEST_LARGE_QUERY_IDLE_TTL_MS,
    );
    expect(atoms.diff({ environmentId, input: reference }).idleTTL).toBe(
      PULL_REQUEST_LARGE_QUERY_IDLE_TTL_MS,
    );
  });
});
