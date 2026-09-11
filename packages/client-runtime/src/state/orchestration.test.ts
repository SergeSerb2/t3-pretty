import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  ARCHIVED_SHELL_SNAPSHOT_IDLE_TTL_MS,
  createOrchestrationEnvironmentAtoms,
  ORCHESTRATION_DIFF_IDLE_TTL_MS,
} from "./orchestration.ts";

describe("orchestration environment atoms", () => {
  it("releases an idle archived shell snapshot on the thread-detail retention window", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry,
      never
    >;
    const atoms = createOrchestrationEnvironmentAtoms(runtime);

    expect(
      atoms.archivedShellSnapshot({
        environmentId: EnvironmentId.make("environment-1"),
        input: {},
      }).idleTTL,
    ).toBe(ARCHIVED_SHELL_SNAPSHOT_IDLE_TTL_MS);
  });

  it("releases idle diff payloads before the generic query TTL", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry,
      never
    >;
    const atoms = createOrchestrationEnvironmentAtoms(runtime);
    const environmentId = EnvironmentId.make("environment-1");
    const threadId = ThreadId.make("thread-1");

    expect(
      atoms.turnDiff({
        environmentId,
        input: { threadId, fromTurnCount: 0, toTurnCount: 1 },
      }).idleTTL,
    ).toBe(ORCHESTRATION_DIFF_IDLE_TTL_MS);
    expect(
      atoms.fullThreadDiff({
        environmentId,
        input: { threadId, toTurnCount: 1 },
      }).idleTTL,
    ).toBe(ORCHESTRATION_DIFF_IDLE_TTL_MS);
  });
});
