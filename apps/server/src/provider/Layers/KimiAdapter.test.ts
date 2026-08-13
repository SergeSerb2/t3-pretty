// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ApprovalRequestId,
  KimiSettings,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { makeKimiAdapter } from "./KimiAdapter.ts";

const decodeKimiSettings = Schema.decodeSync(KimiSettings);
const currentDirectory = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const mockAgentPath = NodePath.join(currentDirectory, "../../../scripts/acp-mock-agent.ts");

async function makeKimiMockWrapper(
  requestLogPath: string,
  options?: { readonly emitToolCalls?: boolean },
) {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kimi-acp-mock-"));
  const wrapperPath = NodePath.join(directory, "kimi");
  const script = `#!/bin/sh
export T3_ACP_KIMI=1
export T3_ACP_REQUEST_LOG_PATH=${JSON.stringify(requestLogPath)}
${options?.emitToolCalls ? "export T3_ACP_EMIT_TOOL_CALLS=1\n" : ""}exec node ${JSON.stringify(mockAgentPath)} "$@"
`;
  await NodeFSP.writeFile(wrapperPath, script, "utf8");
  await NodeFSP.chmod(wrapperPath, 0o755);
  return wrapperPath;
}

const testServices = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3code-kimi-adapter-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

it.effect("runs Kimi sessions through ACP with models, thinking, modes, and streaming", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kimi-acp-log-")),
    );
    const requestLogPath = NodePath.join(directory, "requests.ndjson");
    const binaryPath = yield* Effect.promise(() => makeKimiMockWrapper(requestLogPath));
    const adapter = yield* makeKimiAdapter(decodeKimiSettings({ binaryPath }));
    const threadId = ThreadId.make("kimi-mock-thread");
    const eventsFiber = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.threadId === threadId),
      Stream.takeUntil((event) => event.type === "turn.completed"),
      Stream.runCollect,
      Effect.forkChild,
    );

    const session = yield* adapter.startSession({
      threadId,
      provider: ProviderDriverKind.make("kimi"),
      cwd: process.cwd(),
      runtimeMode: "full-access",
      modelSelection: {
        instanceId: ProviderInstanceId.make("kimi"),
        model: "kimi-code/k3-256k",
        options: [{ id: "thinking", value: "max" }],
      },
    });
    assert.equal(session.provider, "kimi");
    assert.deepEqual(session.resumeCursor, {
      schemaVersion: 1,
      sessionId: "mock-session-1",
    });

    yield* adapter.sendTurn({
      threadId,
      input: "Reply from the Kimi ACP mock.",
      attachments: [],
    });

    const events = Array.from(yield* Fiber.join(eventsFiber));
    assert.include(
      events.map((event) => event.type),
      "content.delta",
    );
    const delta = events.find(
      (event) => event.type === "content.delta" && event.payload.streamKind === "assistant_text",
    );
    assert.equal(
      delta?.type === "content.delta" ? delta.payload.delta : undefined,
      "hello from mock",
    );
    const reasoningDelta = events.find(
      (event) => event.type === "content.delta" && event.payload.streamKind === "reasoning_text",
    );
    assert.equal(
      reasoningDelta?.type === "content.delta" ? reasoningDelta.payload.delta : undefined,
      "thinking through Kimi mock",
    );

    const requestLog = yield* Effect.promise(() => NodeFSP.readFile(requestLogPath, "utf8"));
    assert.include(requestLog, '"method":"initialize"');
    assert.include(requestLog, '"value":"kimi-code/k3-256k"');
    assert.include(requestLog, '"value":"max"');
    assert.include(requestLog, '"value":"yolo"');

    yield* adapter.stopSession(threadId);
  }).pipe(Effect.provide(testServices)),
);

it.effect("yolo keeps Kimi's full-access mode but forwards permission prompts", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kimi-acp-log-")),
    );
    const requestLogPath = NodePath.join(directory, "requests.ndjson");
    const binaryPath = yield* Effect.promise(() =>
      makeKimiMockWrapper(requestLogPath, { emitToolCalls: true }),
    );
    const adapter = yield* makeKimiAdapter(decodeKimiSettings({ binaryPath }));
    const threadId = ThreadId.make("kimi-mock-yolo-thread");
    const requestOpened =
      yield* Deferred.make<Extract<ProviderRuntimeEvent, { type: "request.opened" }>>();
    const eventsFiber = yield* Stream.runForEach(adapter.streamEvents, (event) =>
      event.type === "request.opened"
        ? Deferred.succeed(requestOpened, event).pipe(Effect.ignore)
        : Effect.void,
    ).pipe(Effect.forkChild);

    yield* adapter.startSession({
      threadId,
      provider: ProviderDriverKind.make("kimi"),
      cwd: process.cwd(),
      runtimeMode: "yolo",
      modelSelection: {
        instanceId: ProviderInstanceId.make("kimi"),
        model: "kimi-code/k3-256k",
      },
    });

    const sendTurnFiber = yield* adapter
      .sendTurn({ threadId, input: "Run the tool call.", attachments: [] })
      .pipe(Effect.forkChild);
    const requestOpenedEvent = yield* Deferred.await(requestOpened);
    assert.equal(requestOpenedEvent.threadId, threadId);

    yield* adapter.respondToRequest(
      threadId,
      ApprovalRequestId.make(String(requestOpenedEvent.requestId)),
      "accept",
    );
    yield* Fiber.join(sendTurnFiber);

    const requestLog = yield* Effect.promise(() => NodeFSP.readFile(requestLogPath, "utf8"));
    assert.include(requestLog, '"value":"yolo"');

    yield* Fiber.interrupt(eventsFiber);
    yield* adapter.stopSession(threadId);
  }).pipe(Effect.provide(testServices)),
);

it.effect("full-access auto-approves permission prompts without asking", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "kimi-acp-log-")),
    );
    const requestLogPath = NodePath.join(directory, "requests.ndjson");
    const binaryPath = yield* Effect.promise(() =>
      makeKimiMockWrapper(requestLogPath, { emitToolCalls: true }),
    );
    const adapter = yield* makeKimiAdapter(decodeKimiSettings({ binaryPath }));
    const threadId = ThreadId.make("kimi-mock-full-access-thread");
    const eventsFiber = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.threadId === threadId),
      Stream.takeUntil((event) => event.type === "turn.completed"),
      Stream.runCollect,
      Effect.forkChild,
    );

    yield* adapter.startSession({
      threadId,
      provider: ProviderDriverKind.make("kimi"),
      cwd: process.cwd(),
      runtimeMode: "full-access",
      modelSelection: {
        instanceId: ProviderInstanceId.make("kimi"),
        model: "kimi-code/k3-256k",
      },
    });
    yield* adapter.sendTurn({ threadId, input: "Run the tool call.", attachments: [] });

    const events = Array.from(yield* Fiber.join(eventsFiber));
    assert.isFalse(events.some((event) => event.type === "request.opened"));
    assert.include(
      events.map((event) => event.type),
      "content.delta",
    );

    yield* adapter.stopSession(threadId);
  }).pipe(Effect.provide(testServices)),
);

it.effect("optionally smoke-tests the installed Kimi CLI", () => {
  if (process.env.T3_KIMI_LIVE !== "1") return Effect.void;

  return Effect.gen(function* () {
    const binaryPath = process.env.T3_KIMI_BINARY?.trim() || "kimi";
    const adapter = yield* makeKimiAdapter(decodeKimiSettings({ binaryPath }));
    const threadId = ThreadId.make("kimi-live-smoke-thread");
    const eventsFiber = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.threadId === threadId),
      Stream.takeUntil((event) => event.type === "turn.completed"),
      Stream.runCollect,
      Effect.forkChild,
    );

    yield* adapter.startSession({
      threadId,
      provider: ProviderDriverKind.make("kimi"),
      cwd: process.cwd(),
      runtimeMode: "full-access",
      modelSelection: {
        instanceId: ProviderInstanceId.make("kimi"),
        model: "kimi-code/k3",
        options: [{ id: "thinking", value: "low" }],
      },
    });
    yield* adapter.sendTurn({
      threadId,
      input: "Reply with exactly T3_KIMI_OK and do not use tools.",
      attachments: [],
    });

    const response = Array.from(yield* Fiber.join(eventsFiber))
      .flatMap((event) =>
        event.type === "content.delta" && event.payload.streamKind === "assistant_text"
          ? [event.payload.delta]
          : [],
      )
      .join("")
      .trim();
    assert.equal(response, "T3_KIMI_OK");
    yield* adapter.stopSession(threadId);
  }).pipe(Effect.provide(testServices));
});
