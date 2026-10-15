import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, ThreadId, type OrchestrationV2ShellSnapshot } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import type { HttpClient } from "effect/unstable/http";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { nextShellResumeCache, SHELL_SNAPSHOT_IDLE_TTL_MS } from "./shell.ts";
import {
  ARCHIVED_SHELL_SNAPSHOT_IDLE_TTL_MS,
  createOrchestrationEnvironmentAtoms,
  ORCHESTRATION_DIFF_IDLE_TTL_MS,
} from "./orchestration.ts";

describe("orchestration environment atoms", () => {
  it("releases an idle archived shell snapshot on the thread-detail retention window", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry | HttpClient.HttpClient,
      never
    >;
    const atoms = createOrchestrationEnvironmentAtoms(runtime);

    expect(
      atoms.archivedShellSnapshot({
        environmentId: EnvironmentId.make("environment-1"),
        input: {},
      }).idleTTL,
    ).toBe(ARCHIVED_SHELL_SNAPSHOT_IDLE_TTL_MS);
    expect(SHELL_SNAPSHOT_IDLE_TTL_MS).toBe(ARCHIVED_SHELL_SNAPSHOT_IDLE_TTL_MS);
  });

  it("releases idle diff payloads before the generic query TTL", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry | HttpClient.HttpClient,
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

  it("keeps a painted shell across a replacement supervisor's leading empty", () => {
    const snapshot = Option.some({
      schemaVersion: 1,
      snapshotSequence: 1,
      threads: [],
      archivedThreads: [],
      projects: [],
    } satisfies OrchestrationV2ShellSnapshot);
    const painted = nextShellResumeCache(undefined, {
      snapshot,
      status: "synchronizing",
      error: Option.none(),
    });
    expect(painted?.snapshot).toBe(snapshot);
    expect(
      nextShellResumeCache(painted, {
        snapshot: Option.none(),
        status: "empty",
        error: Option.none(),
      }),
    ).toBe(painted);
    expect(
      nextShellResumeCache(painted, {
        snapshot: Option.none(),
        status: "empty",
        error: Option.some("Could not synchronize environment data."),
      }),
    ).toBe(painted);
  });
});
