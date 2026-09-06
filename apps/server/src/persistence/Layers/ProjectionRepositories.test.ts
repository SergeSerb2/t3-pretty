import {
  AutomationId,
  AutomationRunId,
  EventId,
  ProjectId,
  ThreadId,
  ProviderInstanceId,
  type AutomationRun,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProjectionAutomationRepositoryLive } from "./ProjectionAutomations.ts";
import { ProjectionAutomationRunRepositoryLive } from "./ProjectionAutomationRuns.ts";
import { ProjectionProjectRepositoryLive } from "./ProjectionProjects.ts";
import { ProjectionThreadRepositoryLive } from "./ProjectionThreads.ts";
import { ProjectionAutomationRepository } from "../Services/ProjectionAutomations.ts";
import { ProjectionAutomationRunRepository } from "../Services/ProjectionAutomationRuns.ts";
import { ProjectionProjectRepository } from "../Services/ProjectionProjects.ts";
import { ProjectionThreadRepository } from "../Services/ProjectionThreads.ts";

const projectionRepositoriesLayer = it.layer(
  Layer.mergeAll(
    ProjectionProjectRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionThreadRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionAutomationRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    ProjectionAutomationRunRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    SqlitePersistenceMemory,
  ),
);

projectionRepositoriesLayer("Projection repositories", (it) => {
  it.effect("stores SQL NULL for missing project model options", () =>
    Effect.gen(function* () {
      const projects = yield* ProjectionProjectRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* projects.upsert({
        projectId: ProjectId.make("project-null-options"),
        title: "Null options project",
        workspaceRoot: "/tmp/project-null-options",
        defaultModelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        defaultThreadEnvMode: null,
        autoPull: false,
        scripts: [],
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly defaultModelSelection: string | null;
      }>`
        SELECT default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.die("Expected projection_projects row to exist.");
      }

      assert.strictEqual(
        row.defaultModelSelection,
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        JSON.stringify({
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        }),
      );

      const persisted = yield* projects.getById({
        projectId: ProjectId.make("project-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.defaultModelSelection, {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      });
    }),
  );

  it.effect("stores JSON for thread model options", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;
      const sql = yield* SqlClient.SqlClient;

      yield* threads.upsert({
        threadId: ThreadId.make("thread-null-options"),
        projectId: ProjectId.make("project-null-options"),
        title: "Null options thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        enabledSkillIds: [],
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        unsettledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      });

      const rows = yield* sql<{
        readonly modelSelection: string | null;
      }>`
        SELECT model_selection_json AS "modelSelection"
        FROM projection_threads
        WHERE thread_id = 'thread-null-options'
      `;
      const row = rows[0];
      if (!row) {
        return yield* Effect.die("Expected projection_threads row to exist.");
      }

      assert.strictEqual(
        row.modelSelection,
        // @effect-diagnostics-next-line preferSchemaOverJson:off
        JSON.stringify({
          instanceId: ProviderInstanceId.make("claudeAgent"),
          model: "claude-opus-4-6",
        }),
      );

      const persisted = yield* threads.getById({
        threadId: ThreadId.make("thread-null-options"),
      });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.modelSelection, {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "claude-opus-4-6",
      });
    }),
  );

  it.effect("round-trips non-null settlement values through the thread row", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;

      yield* threads.upsert({
        threadId: ThreadId.make("thread-settled"),
        projectId: ProjectId.make("project-1"),
        title: "Settled thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        enabledSkillIds: [],
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-25T00:00:00.000Z",
        archivedAt: null,
        settledOverride: "settled",
        settledAt: "2026-03-25T00:00:00.000Z",
        unsettledAt: null,
        snoozedUntil: "2026-03-26T09:00:00.000Z",
        snoozedAt: "2026-03-25T00:00:00.000Z",
        pinnedAt: "2026-03-25T00:00:00.000Z",
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      });

      const persisted = yield* threads.getById({
        threadId: ThreadId.make("thread-settled"),
      });
      const row = Option.getOrNull(persisted);
      if (!row) {
        return yield* Effect.die("Expected settled projection_threads row to exist.");
      }
      assert.strictEqual(row.settledOverride, "settled");
      assert.strictEqual(row.settledAt, "2026-03-25T00:00:00.000Z");
      assert.strictEqual(row.snoozedUntil, "2026-03-26T09:00:00.000Z");
      assert.strictEqual(row.snoozedAt, "2026-03-25T00:00:00.000Z");
      assert.strictEqual(row.pinnedAt, "2026-03-25T00:00:00.000Z");

      // Un-settle to the keep-active pin and wake the snooze; confirm the
      // flips persist.
      yield* threads.upsert({
        ...row,
        settledOverride: "active",
        settledAt: null,
        unsettledAt: "2026-03-26T00:00:00.000Z",
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
      });
      const repersisted = yield* threads.getById({
        threadId: ThreadId.make("thread-settled"),
      });
      const updated = Option.getOrNull(repersisted);
      assert.strictEqual(updated?.settledOverride, "active");
      assert.strictEqual(updated?.settledAt, null);
      assert.strictEqual(updated?.unsettledAt, "2026-03-26T00:00:00.000Z");
      assert.strictEqual(updated?.snoozedUntil, null);
      assert.strictEqual(updated?.snoozedAt, null);
      assert.strictEqual(updated?.pinnedAt, null);
    }),
  );
  it.effect("records branch heads only for the current branch event", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;
      const threadId = ThreadId.make("thread-branch-head");
      const firstBranchEventId = EventId.make("event-branch-first");
      const secondBranchEventId = EventId.make("event-branch-second");

      yield* threads.upsert({
        threadId,
        projectId: ProjectId.make("project-1"),
        title: "Branch head thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "feature/one",
        branchEventId: firstBranchEventId,
        branchHeadRef: null,
        branchHeadRepository: null,
        branchHeadOwner: null,
        branchHeadIsCrossRepository: null,
        worktreePath: null,
        enabledSkillIds: [],
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        unsettledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      });
      yield* threads.recordBranchHead({
        threadId,
        branchEventId: firstBranchEventId,
        headRef: "feature/fork-one",
        repositoryNameWithOwner: "octocat/repo",
        ownerLogin: "octocat",
        isCrossRepository: true,
      });

      const first = Option.getOrThrow(yield* threads.getById({ threadId }));
      yield* threads.upsert({ ...first, title: "Unrelated update" });
      const preserved = Option.getOrThrow(yield* threads.getById({ threadId }));
      assert.strictEqual(preserved.branchHeadRepository, "octocat/repo");

      yield* threads.upsert({
        ...preserved,
        branch: "feature/two",
        branchEventId: secondBranchEventId,
        branchHeadRef: null,
        branchHeadRepository: null,
        branchHeadOwner: null,
        branchHeadIsCrossRepository: null,
      });
      yield* threads.recordBranchHead({
        threadId,
        branchEventId: firstBranchEventId,
        headRef: "feature/stale",
        repositoryNameWithOwner: "intruder/repo",
        ownerLogin: "intruder",
        isCrossRepository: true,
      });

      const current = Option.getOrThrow(yield* threads.getById({ threadId }));
      assert.strictEqual(current.branchEventId, secondBranchEventId);
      assert.strictEqual(current.branchHeadRef, null);
      assert.strictEqual(current.branchHeadRepository, null);
    }),
  );

  it.effect("round-trips a linked pull request through the thread row", () =>
    Effect.gen(function* () {
      const threads = yield* ProjectionThreadRepository;
      const linkedPullRequest = {
        projectId: ProjectId.make("project-linked-pr"),
        repository: "pingdotgg/t3code",
        number: 42,
        url: "https://github.com/pingdotgg/t3code/pull/42",
      };

      yield* threads.upsert({
        threadId: ThreadId.make("thread-linked-pr"),
        projectId: ProjectId.make("project-linked-pr"),
        title: "Linked pull request",
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        enabledSkillIds: [],
        linkedPullRequest,
        latestTurnId: null,
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        unsettledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        latestUserMessageAt: null,
        pendingApprovalCount: 0,
        pendingUserInputCount: 0,
        hasActionableProposedPlan: 0,
        deletedAt: null,
      });

      const persisted = yield* threads.getById({ threadId: ThreadId.make("thread-linked-pr") });
      assert.deepStrictEqual(Option.getOrNull(persisted)?.linkedPullRequest, linkedPullRequest);

      const row = Option.getOrNull(persisted);
      if (row === null) return yield* Effect.die("Expected linked thread row to exist.");
      yield* threads.upsert({ ...row, linkedPullRequest: null });

      const cleared = yield* threads.getById({ threadId: ThreadId.make("thread-linked-pr") });
      assert.strictEqual(Option.getOrNull(cleared)?.linkedPullRequest, null);
    }),
  );
  it.effect("round-trips an automation row with booleans and JSON columns", () =>
    Effect.gen(function* () {
      const automations = yield* ProjectionAutomationRepository;
      const automationId = AutomationId.make("automation-1");
      const row = {
        id: automationId,
        projectId: ProjectId.make("project-1"),
        name: "Nightly",
        prompt: "Do the thing",
        enabled: false,
        triggers: [{ type: "schedule" as const, cron: "0 9 * * *", timezone: "UTC" }],
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access" as const,
        workspace: "worktree" as const,
        createPullRequest: true,
        includeLastRunSummary: false,
        catchUpMissedRuns: true,
        minIntervalSeconds: 60,
        timeoutMinutes: 120,
        webhookToken: "token",
        sourceThreadId: ThreadId.make("thread-source"),
        createdAt: "2026-03-24T00:00:00.000Z",
        updatedAt: "2026-03-24T00:00:00.000Z",
        nextRunAt: null,
        activeRun: {
          runId: AutomationRunId.make("run-1"),
          threadId: null,
          requestedAt: "2026-03-24T00:00:00.000Z",
          startedAt: null,
        },
        lastRun: null,
        lastRequestedAt: "2026-03-24T00:00:00.000Z",
        pendingTrigger: { type: "webhook" as const, deliveryId: "d-1", payload: "{}" },
        consecutiveFailures: 2,
        runCount: 5,
      };
      yield* automations.upsert(row);
      assert.deepStrictEqual(Option.getOrNull(yield* automations.getById({ automationId })), row);
      assert.deepStrictEqual(
        (yield* automations.listByProjectId({ projectId: row.projectId })).map((entry) => entry.id),
        [automationId],
      );
      yield* automations.deleteById({ automationId });
      assert.isTrue(Option.isNone(yield* automations.getById({ automationId })));
    }),
  );

  it.effect("pages runs newest first and prunes beyond the retention window", () =>
    Effect.gen(function* () {
      const runs = yield* ProjectionAutomationRunRepository;
      const automationId = AutomationId.make("automation-runs");
      const makeRun = (index: number): AutomationRun => ({
        id: AutomationRunId.make(`run-${index}`),
        automationId,
        projectId: ProjectId.make("project-1"),
        threadId: index % 2 === 0 ? ThreadId.make(`thread-${index}`) : null,
        status: "completed",
        trigger: { type: "manual", byThreadId: null },
        requestedAt: `2026-03-24T00:00:0${index}.000Z`,
        startedAt: null,
        finishedAt: null,
        error: null,
        summary: null,
      });
      for (const index of [1, 2, 3, 4]) {
        yield* runs.upsert(makeRun(index));
      }

      const firstPage = yield* runs.listPage({ automationId, limit: 3 });
      assert.deepStrictEqual(
        firstPage.map((run) => run.id),
        ["run-4", "run-3", "run-2"],
      );
      const secondPage = yield* runs.listPage({
        automationId,
        limit: 3,
        before: { requestedAt: firstPage[2]!.requestedAt, runId: firstPage[2]!.id },
      });
      assert.deepStrictEqual(
        secondPage.map((run) => run.id),
        ["run-1"],
      );

      yield* runs.pruneBeyond({ automationId, keep: 2 });
      assert.deepStrictEqual(
        (yield* runs.listPage({ automationId, limit: 10 })).map((run) => run.id),
        ["run-4", "run-3"],
      );
      yield* runs.deleteByAutomationId({ automationId });
      assert.deepStrictEqual(yield* runs.listPage({ automationId, limit: 10 }), []);
    }),
  );
});
