import {
  CommandId,
  EnvironmentId,
  MessageId,
  ORCHESTRATION_WS_METHODS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ClientOrchestrationCommand,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as RpcSession from "../rpc/session.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import {
  archiveThread,
  createProject,
  createThread,
  setThreadSkills,
  setThreadSubagentPolicy,
  settleThread,
  snoozeThread,
  startThreadTurn,
  stopThreadSession,
  unsettleThread,
} from "./commands.ts";
import {
  makeThreadLifecycleOutbox,
  ThreadLifecycleOutbox,
} from "../state/threadLifecycleOutbox.ts";

const TEST_CRYPTO_LAYER = Layer.succeed(
  Crypto.Crypto,
  Crypto.make({
    randomBytes: (size) => new Uint8Array(size),
    digest: (_algorithm, data) => Effect.succeed(data),
  }),
);

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});

const makeSupervisor = Effect.fn("TestEnvironmentCommands.makeSupervisor")(function* (
  dispatched: ClientOrchestrationCommand[],
) {
  const client = {
    [ORCHESTRATION_WS_METHODS.dispatchCommand]: (command: ClientOrchestrationCommand) =>
      Effect.sync(() => {
        dispatched.push(command);
        return { sequence: dispatched.length };
      }),
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession.RpcSession = {
    client,
    initialConfig: Effect.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  return EnvironmentSupervisor.EnvironmentSupervisor.of({
    target: TARGET,
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    session: yield* SubscriptionRef.make(Option.some(session)),
    prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
});

describe("environment commands", () => {
  it.effect("adds generated command metadata", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      const result = yield* createProject({
        projectId: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/workspace/project",
        createdAt: "2026-06-06T00:00:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(result).toEqual({ sequence: 1 });
      expect(dispatched).toEqual([
        {
          type: "project.create",
          commandId: "00000000-0000-4000-8000-000000000000",
          projectId: "project-1",
          title: "Project",
          workspaceRoot: "/workspace/project",
          createdAt: "2026-06-06T00:00:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("preserves caller metadata for idempotent queued commands", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* stopThreadSession({
        commandId: CommandId.make("queued-command"),
        threadId: ThreadId.make("thread-1"),
        createdAt: "2026-06-06T00:01:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.session.stop",
          commandId: "queued-command",
          threadId: "thread-1",
          createdAt: "2026-06-06T00:01:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("does not add timestamps to commands without createdAt", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* archiveThread({
        commandId: CommandId.make("archive-command"),
        threadId: ThreadId.make("thread-1"),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.archive",
          commandId: "archive-command",
          threadId: "thread-1",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("queues settle and snooze when the environment is offline", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
        target: TARGET,
        state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
        session: yield* SubscriptionRef.make(Option.none<RpcSession.RpcSession>()),
        prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
        connect: Effect.void,
        disconnect: Effect.void,
        retryNow: Effect.void,
      } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
      const outbox = yield* makeThreadLifecycleOutbox();

      const settle = yield* settleThread({
        commandId: CommandId.make("settle-offline"),
        threadId: ThreadId.make("thread-1"),
      }).pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        Effect.provideService(ThreadLifecycleOutbox, outbox),
      );
      const snooze = yield* snoozeThread({
        commandId: CommandId.make("snooze-offline"),
        threadId: ThreadId.make("thread-1"),
        snoozedUntil: "2026-08-16T12:00:00.000Z",
      }).pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
        Effect.provideService(ThreadLifecycleOutbox, outbox),
      );

      expect(settle).toEqual({ sequence: 0 });
      expect(snooze).toEqual({ sequence: 0 });
      expect(dispatched).toEqual([]);
      const pending = (yield* SubscriptionRef.get(outbox.pending)).get(TARGET.environmentId) ?? [];
      expect(pending.map((entry) => entry.command.type)).toEqual([
        "thread.settle",
        "thread.snooze",
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("dispatches settle and unsettle commands without timestamps", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* settleThread({
        commandId: CommandId.make("settle-command"),
        threadId: ThreadId.make("thread-1"),
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
      yield* unsettleThread({
        commandId: CommandId.make("unsettle-command"),
        threadId: ThreadId.make("thread-1"),
        reason: "user",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.settle",
          commandId: "settle-command",
          threadId: "thread-1",
        },
        {
          type: "thread.unsettle",
          commandId: "unsettle-command",
          threadId: "thread-1",
          reason: "user",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("dispatches thread.skills.set with minted metadata", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* setThreadSkills({
        threadId: ThreadId.make("thread-1"),
        enabledSkillIds: ["mattpocock/skills:skills/engineering/tdd"],
        createdAt: "2026-06-06T00:02:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.skills.set",
          commandId: "00000000-0000-4000-8000-000000000000",
          threadId: "thread-1",
          enabledSkillIds: ["mattpocock/skills:skills/engineering/tdd"],
          createdAt: "2026-06-06T00:02:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("dispatches thread.subagent-policy.set with minted metadata", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      yield* setThreadSubagentPolicy({
        threadId: ThreadId.make("thread-1"),
        policy: { mode: "off" },
        createdAt: "2026-06-06T00:03:00.000Z",
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.subagent-policy.set",
          commandId: "00000000-0000-4000-8000-000000000000",
          threadId: "thread-1",
          policy: { mode: "off" },
          createdAt: "2026-06-06T00:03:00.000Z",
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect("defaults omitted enabledSkillIds to [] on thread.create", () =>
    Effect.gen(function* () {
      const dispatched: ClientOrchestrationCommand[] = [];
      const supervisor = yield* makeSupervisor(dispatched);

      const baseInput = {
        threadId: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access" as const,
        interactionMode: "default" as const,
        branch: null,
        worktreePath: null,
        createdAt: "2026-06-06T00:03:00.000Z",
      };
      yield* createThread(baseInput).pipe(
        Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
      );
      yield* createThread({
        ...baseInput,
        threadId: ThreadId.make("thread-2"),
        enabledSkillIds: ["mattpocock/skills:skills/engineering/tdd"],
      }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

      expect(dispatched).toEqual([
        {
          type: "thread.create",
          commandId: "00000000-0000-4000-8000-000000000000",
          threadId: "thread-1",
          projectId: "project-1",
          title: "Thread",
          modelSelection: { instanceId: "codex", model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-06-06T00:03:00.000Z",
          enabledSkillIds: [],
        },
        {
          type: "thread.create",
          commandId: "00000000-0000-4000-8000-000000000000",
          threadId: "thread-2",
          projectId: "project-1",
          title: "Thread",
          modelSelection: { instanceId: "codex", model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-06-06T00:03:00.000Z",
          enabledSkillIds: ["mattpocock/skills:skills/engineering/tdd"],
        },
      ]);
    }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );

  it.effect(
    "defaults omitted bootstrap.createThread.enabledSkillIds to [] on thread.turn.start",
    () =>
      Effect.gen(function* () {
        const dispatched: ClientOrchestrationCommand[] = [];
        const supervisor = yield* makeSupervisor(dispatched);

        const createThreadBootstrap = {
          projectId: ProjectId.make("project-1"),
          title: "Thread",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          runtimeMode: "full-access" as const,
          interactionMode: "default" as const,
          branch: null,
          worktreePath: null,
          createdAt: "2026-06-06T00:04:00.000Z",
        };
        yield* startThreadTurn({
          threadId: ThreadId.make("thread-1"),
          message: {
            messageId: MessageId.make("message-1"),
            role: "user",
            text: "hello",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          bootstrap: { createThread: createThreadBootstrap },
          createdAt: "2026-06-06T00:04:00.000Z",
        }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));
        yield* startThreadTurn({
          threadId: ThreadId.make("thread-2"),
          message: {
            messageId: MessageId.make("message-2"),
            role: "user",
            text: "hello",
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          bootstrap: {
            createThread: {
              ...createThreadBootstrap,
              enabledSkillIds: ["mattpocock/skills:skills/engineering/tdd"],
            },
          },
          createdAt: "2026-06-06T00:04:00.000Z",
        }).pipe(Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor));

        expect(dispatched[0]).toMatchObject({
          type: "thread.turn.start",
          bootstrap: { createThread: { enabledSkillIds: [] } },
        });
        expect(dispatched[1]).toMatchObject({
          type: "thread.turn.start",
          bootstrap: {
            createThread: {
              enabledSkillIds: ["mattpocock/skills:skills/engineering/tdd"],
            },
          },
        });
      }).pipe(Effect.provide(TEST_CRYPTO_LAYER)),
  );
});
