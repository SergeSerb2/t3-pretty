import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import * as ShellStream from "./ShellStream.ts";

const threadId = ThreadId.make("thread-1");
const now = "2026-01-01T00:00:00.000Z";

const makeEvent = (
  sequence: number,
  type: OrchestrationEvent["type"],
  payload: unknown = {},
): OrchestrationEvent =>
  ({
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: `2026-01-01T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type,
    payload,
  }) as OrchestrationEvent;

const activityEvent = (sequence: number, kind: string) =>
  makeEvent(sequence, "thread.activity-appended", {
    threadId,
    activity: { id: `activity-${sequence}`, kind, summary: kind, payload: {}, createdAt: now },
  });

const shell: OrchestrationThreadShell = {
  id: threadId,
  projectId: ProjectId.make("project-1"),
  title: "Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  enabledSkillIds: [],
  latestTurn: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};

describe("isShellTouchEvent", () => {
  it("touches for streamed messages and plain activities, refetches for shell-shaping ones", () => {
    assert.isTrue(
      ShellStream.isShellTouchEvent(
        makeEvent(1, "thread.message-sent", { role: "assistant", streaming: true }),
      ),
    );
    assert.isTrue(ShellStream.isShellTouchEvent(activityEvent(2, "tool.updated")));
    assert.isFalse(
      ShellStream.isShellTouchEvent(
        makeEvent(3, "thread.message-sent", { role: "user", streaming: false }),
      ),
    );
    assert.isFalse(ShellStream.isShellTouchEvent(activityEvent(4, "approval.requested")));
    assert.isFalse(ShellStream.isShellTouchEvent(activityEvent(5, "turn.plan.updated")));
    assert.isFalse(ShellStream.isShellTouchEvent(makeEvent(6, "thread.session-set")));
  });
});

describe("makeShellStreamProjector", () => {
  const makeProjector = (fetches: Array<string>) =>
    ShellStream.makeShellStreamProjector({
      getThreadShellById: (id: ThreadId) =>
        Effect.sync(() => {
          fetches.push(id);
          return Option.some(shell);
        }),
    } as unknown as ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"]);

  it.effect("collapses a touch-only burst into one thread-touched with no read", () =>
    Effect.gen(function* () {
      const fetches: Array<string> = [];
      const items = yield* makeProjector(fetches).coalesceShellEvents([
        activityEvent(1, "tool.updated"),
        activityEvent(2, "tool.updated"),
        makeEvent(3, "thread.message-sent", { role: "assistant", streaming: true }),
      ]);
      assert.deepEqual(items, [
        {
          kind: "thread-touched",
          sequence: 3,
          threadId,
          updatedAt: "2026-01-01T00:00:03.000Z",
        },
      ]);
      assert.deepEqual(fetches, []);
    }),
  );

  it.effect("refetches when any event in the aggregate's batch reshapes the shell", () =>
    Effect.gen(function* () {
      const fetches: Array<string> = [];
      const items = yield* makeProjector(fetches).coalesceShellEvents([
        makeEvent(1, "thread.session-set"),
        activityEvent(2, "tool.updated"),
      ]);
      assert.equal(items.length, 1);
      assert.equal(items[0]?.kind, "thread-upserted");
      assert.equal(items[0]?.sequence, 2);
      assert.deepEqual(fetches, [threadId]);
    }),
  );
});

describe("ShellStreamBroadcaster", () => {
  it.live("projects once and fans the same batch out to every subscriber", () =>
    Effect.gen(function* () {
      const liveEvents = yield* PubSub.unbounded<OrchestrationEvent>();
      const fetches: Array<string> = [];
      const layer = ShellStream.layer.pipe(
        Layer.provide(
          Layer.mock(OrchestrationEngine.OrchestrationEngineService)({
            streamDomainEvents: Stream.fromPubSub(liveEvents),
          }),
        ),
        Layer.provide(
          Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
            getThreadShellById: (id) =>
              Effect.sync(() => {
                fetches.push(id);
                return Option.some(shell);
              }),
          }),
        ),
      );
      yield* Effect.gen(function* () {
        const broadcaster = yield* ShellStream.ShellStreamBroadcaster;
        const first = yield* broadcaster.subscribe;
        const second = yield* broadcaster.subscribe;
        yield* PubSub.publish(liveEvents, makeEvent(1, "thread.session-set"));
        yield* PubSub.publish(liveEvents, activityEvent(2, "tool.updated"));
        yield* broadcaster.settle;
        const [firstBatch, secondBatch] = yield* Effect.all([
          PubSub.take(first),
          PubSub.take(second),
        ]);
        assert.strictEqual(firstBatch, secondBatch);
        assert.equal(firstBatch.length, 1);
        assert.equal(firstBatch[0]?.kind, "thread-upserted");
        assert.deepEqual(fetches, [threadId]);
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});
