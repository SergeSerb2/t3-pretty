import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId } from "@t3tools/contracts";
import type * as Crypto from "effect/Crypto";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createProjectEnvironmentAtoms,
  PROJECT_LARGE_QUERY_IDLE_TTL_MS,
} from "./projectCommands.ts";

describe("project environment atoms", () => {
  it("releases idle tree and file payloads before the generic query TTL", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry | Crypto.Crypto,
      never
    >;
    const atoms = createProjectEnvironmentAtoms(runtime);
    const environmentId = EnvironmentId.make("environment-1");

    expect(
      atoms.searchEntries({
        environmentId,
        input: { cwd: "/repo", query: "src", limit: 200 },
      }).idleTTL,
    ).toBe(PROJECT_LARGE_QUERY_IDLE_TTL_MS);
    expect(atoms.listEntries({ environmentId, input: { cwd: "/repo" } }).idleTTL).toBe(
      PROJECT_LARGE_QUERY_IDLE_TTL_MS,
    );
    expect(
      atoms.readFile({
        environmentId,
        input: { cwd: "/repo", relativePath: "README.md" },
      }).idleTTL,
    ).toBe(PROJECT_LARGE_QUERY_IDLE_TTL_MS);
  });
});
