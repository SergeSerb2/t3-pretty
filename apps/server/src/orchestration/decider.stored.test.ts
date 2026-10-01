import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const NOW = "2026-01-01T00:00:00.000Z";
// The decider's clock is the Effect test clock, pinned to the epoch.
const STORED_AT = "1969-12-30T00:00:00.000Z";
const FUTURE_WAKE = "1970-01-02T09:00:00.000Z";
const THREAD_ID = ThreadId.make("thread-1");

function makeReadModel(input: Partial<OrchestrationThread> = {}): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [],
    threads: [
      {
        id: THREAD_ID,
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        enabledSkillIds: [],
        pullRequests: [],
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        unsettledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        storedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
        ...input,
      },
    ],
    updatedAt: NOW,
  };
}

/** Decide a command, then fold its events through the projector. */
const decideAndProject = (readModel: OrchestrationReadModel, command: OrchestrationCommand) =>
  Effect.gen(function* () {
    const result = yield* decideOrchestrationCommand({ command, readModel });
    const events = Array.isArray(result) ? result : [result];
    let model = readModel;
    for (const event of events) {
      model = yield* projectEvent(model, {
        ...event,
        sequence: model.snapshotSequence + 1,
      } as OrchestrationEvent);
    }
    return { types: events.map((event) => event.type), events, thread: model.threads[0]! };
  });

const store = {
  type: "thread.store",
  commandId: CommandId.make("cmd-store"),
  threadId: THREAD_ID,
} as const;
const unstore = {
  type: "thread.unstore",
  commandId: CommandId.make("cmd-unstore"),
  threadId: THREAD_ID,
} as const;

it.layer(NodeServices.layer)("stored thread decider", (it) => {
  it.effect("stores a thread and re-stores idempotently", () =>
    Effect.gen(function* () {
      const fresh = yield* decideAndProject(makeReadModel(), store);
      expect(fresh.types).toEqual(["thread.stored"]);
      expect(fresh.thread.storedAt).not.toBeNull();
      expect(fresh.thread.storedAt).toBe(fresh.thread.updatedAt);

      const again = yield* decideAndProject(makeReadModel({ storedAt: STORED_AT }), store);
      expect(again.types).toEqual(["thread.stored"]);
      expect(again.thread.storedAt).toBe(STORED_AT);
      expect(again.thread.updatedAt).toBe(NOW);
    }),
  );

  it.effect("storing replaces settle, snooze, and pin", () =>
    Effect.gen(function* () {
      const { types, events, thread } = yield* decideAndProject(
        makeReadModel({
          settledOverride: "settled",
          settledAt: NOW,
          snoozedUntil: FUTURE_WAKE,
          snoozedAt: STORED_AT,
          pinnedAt: STORED_AT,
          pinOrderKey: "m",
        }),
        store,
      );
      expect(types).toEqual([
        "thread.stored",
        "thread.unsettled",
        "thread.unsnoozed",
        "thread.unpinned",
      ]);
      const unsettled = events.find((event) => event.type === "thread.unsettled");
      expect(unsettled?.type === "thread.unsettled" && unsettled.payload.reason).toBe("user");
      expect(thread.storedAt).not.toBeNull();
      expect(thread.settledOverride).toBe("active");
      expect(thread.settledAt).toBeNull();
      expect(thread.snoozedUntil).toBeNull();
      expect(thread.pinnedAt).toBeNull();
    }),
  );

  it.effect("rejects storing blocked-on-you work, queued turns, and archived threads", () =>
    Effect.gen(function* () {
      const pendingApproval = {
        id: EventId.make("activity-req-1"),
        tone: "approval" as const,
        kind: "approval.requested",
        summary: "approval.requested",
        payload: { requestId: "req-1" },
        turnId: null,
        createdAt: NOW,
      } as OrchestrationThread["activities"][number];
      // A user message 30s before the epoch test clock with no adopting turn.
      const queuedMessage = {
        id: MessageId.make("message-queued"),
        role: "user",
        text: "Continue",
        turnId: null,
        streaming: false,
        createdAt: "1969-12-31T23:59:30.000Z",
        updatedAt: "1969-12-31T23:59:30.000Z",
      } as OrchestrationThread["messages"][number];
      for (const readModel of [
        makeReadModel({ activities: [pendingApproval] }),
        makeReadModel({ messages: [queuedMessage] }),
        makeReadModel({ archivedAt: NOW }),
      ]) {
        const error = yield* decideOrchestrationCommand({
          command: store,
          readModel,
        }).pipe(Effect.flip);
        expect(error._tag).toBe("OrchestrationCommandInvariantError");
      }
    }),
  );

  it.effect("stores a thread whose session is running", () =>
    Effect.gen(function* () {
      const { types } = yield* decideAndProject(
        makeReadModel({
          session: {
            threadId: THREAD_ID,
            status: "running",
            providerName: "Codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: NOW,
          },
        }),
        store,
      );
      expect(types).toEqual(["thread.stored"]);
    }),
  );

  it.effect("unstoring returns the thread to Active as a user unsettle", () =>
    Effect.gen(function* () {
      const { types, thread } = yield* decideAndProject(
        makeReadModel({ storedAt: STORED_AT }),
        unstore,
      );
      expect(types).toEqual(["thread.unstored", "thread.unsettled"]);
      expect(thread.storedAt).toBeNull();
      // Keep-active protects it from an immediate inactivity auto-settle, and
      // the re-entry stamp sorts it to the top of Active.
      expect(thread.settledOverride).toBe("active");
      expect(thread.unsettledAt).toBe(thread.updatedAt);
      expect(thread.updatedAt).not.toBe(NOW);
    }),
  );

  it.effect("unstoring a thread that is not stored is a silent no-op", () =>
    Effect.gen(function* () {
      const { types, thread } = yield* decideAndProject(makeReadModel(), unstore);
      expect(types).toEqual(["thread.unstored"]);
      expect(thread.settledOverride).toBeNull();
      expect(thread.updatedAt).toBe(NOW);
    }),
  );

  it.effect("settle, snooze, and pin take a thread out of storage", () =>
    Effect.gen(function* () {
      const commands: ReadonlyArray<OrchestrationCommand> = [
        { type: "thread.settle", commandId: CommandId.make("cmd-settle"), threadId: THREAD_ID },
        {
          type: "thread.snooze",
          commandId: CommandId.make("cmd-snooze"),
          threadId: THREAD_ID,
          snoozedUntil: FUTURE_WAKE,
        },
        { type: "thread.pin", commandId: CommandId.make("cmd-pin"), threadId: THREAD_ID },
      ];
      for (const command of commands) {
        const { types, thread } = yield* decideAndProject(
          makeReadModel({ storedAt: STORED_AT }),
          command,
        );
        expect(types).toContain("thread.unstored");
        expect(thread.storedAt).toBeNull();
      }
    }),
  );

  it.effect("activity does not take a thread out of storage", () =>
    Effect.gen(function* () {
      const turnStart = yield* decideAndProject(makeReadModel({ storedAt: STORED_AT }), {
        type: "thread.turn.start",
        commandId: CommandId.make("cmd-turn-start"),
        threadId: THREAD_ID,
        message: {
          messageId: MessageId.make("message-1"),
          role: "user",
          text: "Continue",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: NOW,
      });
      expect(turnStart.types).not.toContain("thread.unstored");
      expect(turnStart.thread.storedAt).toBe(STORED_AT);

      const sessionStart = yield* decideAndProject(makeReadModel({ storedAt: STORED_AT }), {
        type: "thread.session.set",
        commandId: CommandId.make("cmd-session-set"),
        threadId: THREAD_ID,
        session: {
          threadId: THREAD_ID,
          status: "running",
          providerName: "Codex",
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW,
        },
        createdAt: NOW,
      });
      expect(sessionStart.thread.storedAt).toBe(STORED_AT);
    }),
  );

  it.effect("rejects automatic settlement of a stored thread", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.auto-settle",
          commandId: CommandId.make("cmd-auto-settle"),
          threadId: THREAD_ID,
          snapshotSequence: 0,
          settledAt: NOW,
        },
        readModel: makeReadModel({ storedAt: STORED_AT }),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
