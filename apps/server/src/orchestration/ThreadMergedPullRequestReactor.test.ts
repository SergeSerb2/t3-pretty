import {
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationSessionStatus,
  type VcsStatusResult,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionMergedPullRequestCandidate,
} from "./Services/ProjectionSnapshotQuery.ts";
import { layer, ThreadMergedPullRequestReactor } from "./ThreadMergedPullRequestReactor.ts";

const WORKSPACE_ROOT = "/workspace/project-1";
const BRANCH = "feature/merged-pr";

function makeCandidate(input: {
  readonly id: string;
  readonly branch?: string;
  readonly cwd?: string;
  readonly sessionStatus?: OrchestrationSessionStatus | null;
}): ProjectionMergedPullRequestCandidate {
  return {
    threadId: ThreadId.make(input.id),
    branch: input.branch ?? BRANCH,
    cwd: input.cwd ?? WORKSPACE_ROOT,
    sessionStatus: input.sessionStatus ?? null,
  };
}

function status(input: {
  readonly state: "open" | "closed" | "merged";
  readonly refName?: string;
  readonly headRef?: string;
}): VcsStatusResult {
  return {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: input.refName ?? BRANCH,
    hasWorkingTreeChanges: false,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    pr: {
      number: 42,
      title: "Merged feature",
      url: "https://github.com/example/repo/pull/42",
      baseRef: "main",
      headRef: input.headRef ?? BRANCH,
      state: input.state,
    },
  };
}

function runSweep(input: {
  readonly candidates: ReadonlyArray<ProjectionMergedPullRequestCandidate>;
  readonly statusByCwd: ReadonlyMap<string, VcsStatusResult | null>;
}) {
  const dispatched: OrchestrationCommand[] = [];

  const testLayer = layer.pipe(
    Layer.provideMerge(NodeServices.layer),
    Layer.provide(
      Layer.mock(OrchestrationEngineService)({
        dispatch: (command) =>
          Effect.sync(() => {
            dispatched.push(command);
            return { sequence: dispatched.length };
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery)({
        getShellSnapshot: () => Effect.die("getShellSnapshot should not be called"),
        listMergedPullRequestCandidates: () => Effect.succeed(input.candidates),
      }),
    ),
    Layer.provide(
      Layer.succeed(VcsStatusBroadcaster, {
        getStatus: () => Effect.die("getStatus should not be called"),
        peekStatus: ({ cwd }) => Effect.succeed(input.statusByCwd.get(cwd) ?? null),
        refreshLocalStatus: () => Effect.die("refreshLocalStatus should not be called"),
        refreshStatus: () => Effect.die("refreshStatus should not be called"),
        streamStatus: () => Stream.die("streamStatus should not be called"),
      }),
    ),
  );

  return Effect.gen(function* () {
    const reactor = yield* ThreadMergedPullRequestReactor;
    yield* reactor.sweepOnce;
    return dispatched;
  }).pipe(Effect.provide(testLayer));
}

describe("ThreadMergedPullRequestReactor", () => {
  it.effect("persists settlement when the thread's pull request merged", () =>
    Effect.gen(function* () {
      const commands = yield* runSweep({
        candidates: [makeCandidate({ id: "merged", sessionStatus: "ready" })],
        statusByCwd: new Map([[WORKSPACE_ROOT, status({ state: "merged" })]]),
      });

      expect(commands).toHaveLength(2);
      const settleCommand = commands[0];
      expect(settleCommand?.type).toBe("thread.settle");
      if (settleCommand?.type === "thread.settle") {
        expect(settleCommand.threadId).toBe("merged");
        expect(settleCommand.commandId.startsWith("server:auto-settle:pr-merged:")).toBe(true);

        const stopCommand = commands[1];
        expect(stopCommand?.type).toBe("thread.session.stop");
        if (stopCommand?.type === "thread.session.stop") {
          expect(stopCommand.threadId).toBe("merged");
          expect(stopCommand.commandId).toBe(`session-stop-for-settle:${settleCommand.commandId}`);
          expect(stopCommand.onlyIfSettled).toBe(true);
          expect(Number.isNaN(Date.parse(stopCommand.createdAt))).toBe(false);
        }
      }
    }),
  );

  it.effect("does not dispatch redundant stops without a live provider session", () =>
    Effect.gen(function* () {
      for (const sessionStatus of [null, "stopped"] as const) {
        const commands = yield* runSweep({
          candidates: [makeCandidate({ id: `merged-${sessionStatus}`, sessionStatus })],
          statusByCwd: new Map([[WORKSPACE_ROOT, status({ state: "merged" })]]),
        });

        expect(commands.map((command) => command.type)).toEqual(["thread.settle"]);
      }
    }),
  );

  it.effect("uses a thread worktree instead of the project root", () =>
    Effect.gen(function* () {
      const worktreePath = "/workspace/project-1-worktree";
      const commands = yield* runSweep({
        candidates: [makeCandidate({ id: "worktree", cwd: worktreePath })],
        statusByCwd: new Map([[worktreePath, status({ state: "merged" })]]),
      });

      expect(
        commands.flatMap((command) => (command.type === "thread.settle" ? [command.threadId] : [])),
      ).toEqual(["worktree"]);
    }),
  );

  it.effect("does not settle open, closed, or mismatched pull requests", () =>
    Effect.gen(function* () {
      const cases = [
        status({ state: "open" }),
        status({ state: "closed" }),
        status({ state: "merged", refName: "feature/other" }),
        status({ state: "merged", headRef: "feature/other" }),
      ];

      for (const [index, vcsStatus] of cases.entries()) {
        const commands = yield* runSweep({
          candidates: [makeCandidate({ id: `not-merged-${index}` })],
          statusByCwd: new Map([[WORKSPACE_ROOT, vcsStatus]]),
        });
        expect(commands).toEqual([]);
      }
    }),
  );
});
