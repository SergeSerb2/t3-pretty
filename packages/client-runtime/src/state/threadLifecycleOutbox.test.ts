import {
  CommandId,
  EnvironmentId,
  ORCHESTRATION_WS_METHODS,
  OrchestrationDispatchCommandError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ClientOrchestrationCommand,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  applyPendingThreadLifecycleToSnapshot,
  applyPendingThreadLifecycleToThread,
  asQueuedThreadLifecycleCommand,
  coalescePendingThreadLifecycleEntries,
  makeThreadLifecycleOutbox,
  ThreadLifecycleOutboxStore,
  type PendingThreadLifecycleEntry,
} from "./threadLifecycleOutbox.ts";

function isolatedOutboxStore() {
  const memory = new Map<string, ReadonlyArray<PendingThreadLifecycleEntry>>();
  return ThreadLifecycleOutboxStore.of({
    load: (environmentId) => Effect.succeed(memory.get(environmentId) ?? []),
    save: (environmentId, entries) =>
      Effect.sync(() => {
        if (entries.length === 0) {
          memory.delete(environmentId);
        } else {
          memory.set(environmentId, entries);
        }
      }),
  });
}

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const THREAD_ID = ThreadId.make("thread-1");
const OTHER_THREAD_ID = ThreadId.make("thread-2");

const TARGET = new PrimaryConnectionTarget({
  environmentId: ENVIRONMENT_ID,
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

function entry(
  overrides: Partial<PendingThreadLifecycleEntry> & Pick<PendingThreadLifecycleEntry, "command">,
): PendingThreadLifecycleEntry {
  return {
    environmentId: ENVIRONMENT_ID,
    queuedAt: "2026-08-15T12:00:00.000Z",
    ...overrides,
  };
}

function makeShell(overrides: Partial<OrchestrationThreadShell> = {}): OrchestrationThreadShell {
  return {
    id: THREAD_ID,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    enabledSkillIds: [],
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

describe("queued thread lifecycle commands", () => {
  it("only parks settle, unsettle, snooze, and unsnooze", () => {
    expect(
      asQueuedThreadLifecycleCommand({
        type: "thread.archive",
        commandId: CommandId.make("archive"),
        threadId: THREAD_ID,
      }),
    ).toBeNull();
    expect(
      asQueuedThreadLifecycleCommand({
        type: "thread.settle",
        commandId: CommandId.make("settle"),
        threadId: THREAD_ID,
      }),
    ).toEqual({
      type: "thread.settle",
      commandId: "settle",
      threadId: THREAD_ID,
    });
  });

  it("replaces the same-domain command and lets settle drop a parked snooze", () => {
    const snooze = entry({
      command: {
        type: "thread.snooze",
        commandId: CommandId.make("snooze-1"),
        threadId: THREAD_ID,
        snoozedUntil: "2026-08-16T12:00:00.000Z",
      },
    });
    const laterSnooze = entry({
      queuedAt: "2026-08-15T13:00:00.000Z",
      command: {
        type: "thread.snooze",
        commandId: CommandId.make("snooze-2"),
        threadId: THREAD_ID,
        snoozedUntil: "2026-08-17T12:00:00.000Z",
      },
    });
    const settle = entry({
      queuedAt: "2026-08-15T14:00:00.000Z",
      command: {
        type: "thread.settle",
        commandId: CommandId.make("settle-1"),
        threadId: THREAD_ID,
      },
    });
    const otherThread = entry({
      command: {
        type: "thread.settle",
        commandId: CommandId.make("settle-other"),
        threadId: OTHER_THREAD_ID,
      },
    });

    expect(coalescePendingThreadLifecycleEntries([snooze, otherThread], laterSnooze)).toEqual([
      otherThread,
      laterSnooze,
    ]);
    expect(coalescePendingThreadLifecycleEntries([laterSnooze, otherThread], settle)).toEqual([
      otherThread,
      settle,
    ]);
  });
});

describe("pending thread lifecycle overlay", () => {
  it("applies settle by parking the thread and clearing pin or snooze", () => {
    const overlayed = applyPendingThreadLifecycleToThread(
      makeShell({
        pinnedAt: "2026-08-14T00:00:00.000Z",
        pinOrderKey: "a0",
        snoozedUntil: "2026-08-16T12:00:00.000Z",
        snoozedAt: "2026-08-15T00:00:00.000Z",
      }),
      [
        entry({
          command: {
            type: "thread.settle",
            commandId: CommandId.make("settle"),
            threadId: THREAD_ID,
          },
        }),
      ],
    );

    expect(overlayed.settledOverride).toBe("settled");
    expect(overlayed.settledAt).toBe("2026-08-15T12:00:00.000Z");
    expect(overlayed.pinnedAt).toBeNull();
    expect(overlayed.pinOrderKey).toBeNull();
    expect(overlayed.snoozedUntil).toBeNull();
    expect(overlayed.snoozedAt).toBeNull();
  });

  it("applies snooze and unsettle overlays in order", () => {
    const overlayed = applyPendingThreadLifecycleToThread(makeShell(), [
      entry({
        command: {
          type: "thread.snooze",
          commandId: CommandId.make("snooze"),
          threadId: THREAD_ID,
          snoozedUntil: "2026-08-16T09:00:00.000Z",
        },
      }),
      entry({
        queuedAt: "2026-08-15T13:00:00.000Z",
        command: {
          type: "thread.unsettle",
          commandId: CommandId.make("unsettle"),
          threadId: THREAD_ID,
          reason: "user",
        },
      }),
    ]);

    expect(overlayed.snoozedUntil).toBe("2026-08-16T09:00:00.000Z");
    expect(overlayed.settledOverride).toBe("active");
    expect(overlayed.settledAt).toBeNull();
  });

  it("leaves the snapshot identity unchanged when nothing is pending", () => {
    const snapshot: OrchestrationShellSnapshot = {
      snapshotSequence: 4,
      projects: [],
      threads: [makeShell()],
      updatedAt: "2026-08-15T00:00:00.000Z",
    };
    expect(applyPendingThreadLifecycleToSnapshot(snapshot, [])).toBe(snapshot);
  });
});

describe("ThreadLifecycleOutbox", () => {
  it.effect("dispatches parked commands once the environment session is back", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const delivered = yield* Deferred.make<void>();
      const client = {
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command: ClientOrchestrationCommand) =>
          Effect.gen(function* () {
            dispatched.push(command);
            yield* Deferred.succeed(delivered, undefined);
            return { sequence: dispatched.length };
          }),
      } as unknown as WsRpcProtocolClient;
      const session: RpcSession = {
        client,
        initialConfig: Effect.never,
        ready: Effect.void,
        probe: Effect.void,
        closed: Effect.never,
      };
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.none<RpcSession>()),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const outbox = yield* makeThreadLifecycleOutbox();

      const queued = yield* outbox.enqueue(ENVIRONMENT_ID, {
        type: "thread.settle",
        commandId: CommandId.make("settle-offline"),
        threadId: THREAD_ID,
      });
      expect(queued).toBe(true);
      expect(dispatched).toEqual([]);

      const drain = yield* outbox.watchAndDrain(supervisor).pipe(Effect.forkChild);
      yield* SubscriptionRef.set(supervisor.session, Option.some(session));
      yield* Deferred.await(delivered);
      yield* Fiber.interrupt(drain);

      expect(dispatched).toEqual([
        {
          type: "thread.settle",
          commandId: "settle-offline",
          threadId: THREAD_ID,
        },
      ]);
    }).pipe(Effect.provideService(ThreadLifecycleOutboxStore, isolatedOutboxStore())),
  );

  it.effect("drops a parked command the server rejects and keeps going", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const finished = yield* Deferred.make<void>();
      const client = {
        [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command: ClientOrchestrationCommand) =>
          Effect.gen(function* () {
            dispatched.push(command);
            if (command.type === "thread.snooze") {
              return yield* new OrchestrationDispatchCommandError({
                message: "wake time is not in the future",
              });
            }
            yield* Deferred.succeed(finished, undefined);
            return { sequence: dispatched.length };
          }),
      } as unknown as WsRpcProtocolClient;
      const session: RpcSession = {
        client,
        initialConfig: Effect.never,
        ready: Effect.void,
        probe: Effect.void,
        closed: Effect.never,
      };
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.some(session)),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const outbox = yield* makeThreadLifecycleOutbox();

      yield* outbox.enqueue(ENVIRONMENT_ID, {
        type: "thread.snooze",
        commandId: CommandId.make("snooze-expired"),
        threadId: THREAD_ID,
        snoozedUntil: "2026-08-14T12:00:00.000Z",
      });
      yield* outbox.enqueue(ENVIRONMENT_ID, {
        type: "thread.settle",
        commandId: CommandId.make("settle-after"),
        threadId: OTHER_THREAD_ID,
      });

      const drain = yield* outbox.watchAndDrain(supervisor).pipe(Effect.forkChild);
      yield* Deferred.await(finished);
      yield* Fiber.interrupt(drain);

      expect(dispatched.map((command) => command.type)).toEqual(["thread.snooze", "thread.settle"]);
    }).pipe(Effect.provideService(ThreadLifecycleOutboxStore, isolatedOutboxStore())),
  );
});
