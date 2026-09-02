import { ApprovalRequestId, EventId, ThreadId, TurnId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProjectionPendingApprovalRepository } from "../Services/ProjectionPendingApprovals.ts";
import { ProjectionThreadActivityRepository } from "../Services/ProjectionThreadActivities.ts";
import { ProjectionThreadProposedPlanRepository } from "../Services/ProjectionThreadProposedPlans.ts";
import { ProjectionPendingApprovalRepositoryLive } from "./ProjectionPendingApprovals.ts";
import { ProjectionThreadActivityRepositoryLive } from "./ProjectionThreadActivities.ts";
import { ProjectionThreadProposedPlanRepositoryLive } from "./ProjectionThreadProposedPlans.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  Layer.mergeAll(
    ProjectionPendingApprovalRepositoryLive,
    ProjectionThreadActivityRepositoryLive,
    ProjectionThreadProposedPlanRepositoryLive,
  ).pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("Projection thread shell aggregates", (it) => {
  it.effect("counts only unresolved approval rows", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionPendingApprovalRepository;
      const threadId = ThreadId.make("thread-approval-count");

      yield* repository.upsert({
        requestId: ApprovalRequestId.make("approval-pending"),
        threadId,
        turnId: null,
        status: "pending",
        decision: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        resolvedAt: null,
      });
      yield* repository.upsert({
        requestId: ApprovalRequestId.make("approval-resolved"),
        threadId,
        turnId: null,
        status: "resolved",
        decision: "accept",
        createdAt: "2026-01-01T00:00:01.000Z",
        resolvedAt: "2026-01-01T00:00:02.000Z",
      });

      assert.equal(yield* repository.countPendingByThreadId({ threadId }), 1);
    }),
  );

  it.effect("derives unresolved user-input requests without decoding activity history", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadActivityRepository;
      const threadId = ThreadId.make("thread-user-input-count");
      const upsert = (
        activityId: string,
        kind: string,
        requestId: string,
        createdAt: string,
        detail?: string,
      ) =>
        repository.upsert({
          activityId: EventId.make(activityId),
          threadId,
          turnId: null,
          tone: kind === "provider.user-input.respond.failed" ? "error" : "info",
          kind,
          summary: kind,
          payload: { requestId, ...(detail === undefined ? {} : { detail }) },
          createdAt,
        });

      yield* upsert(
        "activity-open-requested",
        "user-input.requested",
        "request-open",
        "2026-01-01T00:00:00.000Z",
      );
      yield* upsert(
        "activity-resolved-requested",
        "user-input.requested",
        "request-resolved",
        "2026-01-01T00:00:01.000Z",
      );
      yield* upsert(
        "activity-resolved",
        "user-input.resolved",
        "request-resolved",
        "2026-01-01T00:00:02.000Z",
      );
      yield* upsert(
        "activity-stale-requested",
        "user-input.requested",
        "request-stale",
        "2026-01-01T00:00:03.000Z",
      );
      yield* upsert(
        "activity-stale-failed",
        "provider.user-input.respond.failed",
        "request-stale",
        "2026-01-01T00:00:04.000Z",
        "Unknown pending user-input request",
      );
      yield* upsert(
        "activity-retry-requested",
        "user-input.requested",
        "request-retry",
        "2026-01-01T00:00:05.000Z",
      );
      yield* upsert(
        "activity-retry-failed",
        "provider.user-input.respond.failed",
        "request-retry",
        "2026-01-01T00:00:06.000Z",
        "Transient provider failure",
      );

      assert.equal(yield* repository.countPendingUserInputByThreadId({ threadId }), 2);
    }),
  );

  it.effect("prioritizes the latest turn when checking for an actionable plan", () =>
    Effect.gen(function* () {
      const repository = yield* ProjectionThreadProposedPlanRepository;
      const threadId = ThreadId.make("thread-actionable-plan");
      const currentTurnId = TurnId.make("turn-current");

      yield* repository.upsert({
        planId: "plan-newer-other-turn",
        threadId,
        turnId: TurnId.make("turn-other"),
        planMarkdown: "Other turn plan",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:03.000Z",
      });
      yield* repository.upsert({
        planId: "plan-current-implemented",
        threadId,
        turnId: currentTurnId,
        planMarkdown: "Implemented current plan",
        implementedAt: "2026-01-01T00:00:02.000Z",
        implementationThreadId: null,
        createdAt: "2026-01-01T00:00:01.000Z",
        updatedAt: "2026-01-01T00:00:02.000Z",
      });

      assert.isFalse(
        yield* repository.hasActionableByThreadId({ threadId, latestTurnId: currentTurnId }),
      );
      assert.isTrue(
        yield* repository.hasActionableByThreadId({
          threadId,
          latestTurnId: TurnId.make("turn-without-plan"),
        }),
      );

      yield* repository.upsert({
        planId: "plan-current-actionable",
        threadId,
        turnId: currentTurnId,
        planMarkdown: "Actionable current plan",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-01-01T00:00:03.000Z",
        updatedAt: "2026-01-01T00:00:04.000Z",
      });

      assert.isTrue(
        yield* repository.hasActionableByThreadId({ threadId, latestTurnId: currentTurnId }),
      );
    }),
  );
});
