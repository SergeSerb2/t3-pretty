import {
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
  type VcsStatusResult,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { VcsStatusBroadcaster } from "../vcs/VcsStatusBroadcaster.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { layer, ThreadMergedPullRequestReactor } from "./ThreadMergedPullRequestReactor.ts";

const PROJECT_ID = ProjectId.make("project-1");
const WORKSPACE_ROOT = "/workspace/project-1";
const BRANCH = "feature/merged-pr";
const NOW = "2026-08-10T00:00:00.000Z";

function makeThread(input: {
  readonly id: string;
  readonly branch?: string | null;
  readonly worktreePath?: string | null;
  readonly settledOverride?: "settled" | "active" | null;
  readonly pinnedAt?: string | null;
  readonly pending?: boolean;
  readonly sessionStatus?: "starting" | "running";
}): OrchestrationThreadShell {
  const threadId = ThreadId.make(input.id);
  return {
    id: threadId,
    projectId: PROJECT_ID,
    title: input.id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: input.branch === undefined ? BRANCH : input.branch,
    worktreePath: input.worktreePath ?? null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: input.settledOverride ?? null,
    settledAt: null,
    ...(input.pinnedAt === undefined ? {} : { pinnedAt: input.pinnedAt }),
    session:
      input.sessionStatus === undefined
        ? null
        : {
            threadId,
            status: input.sessionStatus,
            providerName: "Codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: NOW,
          },
    latestUserMessageAt: null,
    hasPendingApprovals: input.pending ?? false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
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
  readonly threads: ReadonlyArray<OrchestrationThreadShell>;
  readonly statusByCwd: ReadonlyMap<string, VcsStatusResult | null>;
}) {
  const dispatched: OrchestrationCommand[] = [];
  const snapshot: OrchestrationShellSnapshot = {
    snapshotSequence: 1,
    projects: [
      {
        id: PROJECT_ID,
        title: "Project",
        workspaceRoot: WORKSPACE_ROOT,
        defaultModelSelection: null,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    threads: input.threads,
    updatedAt: NOW,
  };

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
        getShellSnapshot: () => Effect.succeed(snapshot),
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
        threads: [makeThread({ id: "merged" })],
        statusByCwd: new Map([[WORKSPACE_ROOT, status({ state: "merged" })]]),
      });

      expect(commands).toHaveLength(1);
      const command = commands[0];
      expect(command?.type).toBe("thread.settle");
      if (command?.type === "thread.settle") {
        expect(command.threadId).toBe("merged");
        expect(command.commandId.startsWith("server:auto-settle:pr-merged:")).toBe(true);
      }
    }),
  );

  it.effect("uses a thread worktree instead of the project root", () =>
    Effect.gen(function* () {
      const worktreePath = "/workspace/project-1-worktree";
      const commands = yield* runSweep({
        threads: [makeThread({ id: "worktree", worktreePath })],
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
          threads: [makeThread({ id: `not-merged-${index}` })],
          statusByCwd: new Map([[WORKSPACE_ROOT, vcsStatus]]),
        });
        expect(commands).toEqual([]);
      }
    }),
  );

  it.effect("honors explicit active state, pins, and live work", () =>
    Effect.gen(function* () {
      const commands = yield* runSweep({
        threads: [
          makeThread({ id: "active", settledOverride: "active" }),
          makeThread({ id: "settled", settledOverride: "settled" }),
          makeThread({ id: "pinned", pinnedAt: NOW }),
          makeThread({ id: "pending", pending: true }),
          makeThread({ id: "running", sessionStatus: "running" }),
        ],
        statusByCwd: new Map([[WORKSPACE_ROOT, status({ state: "merged" })]]),
      });

      expect(commands).toEqual([]);
    }),
  );
});
