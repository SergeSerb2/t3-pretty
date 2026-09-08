import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ApprovalRequestId, ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  type GatewayEvent,
  type GrokBotClient,
  GrokBotGatewayError,
} from "../grokBot/GrokBotGateway.ts";
import { makeGrokBotAdapter, withoutRemoteCredentials } from "./GrokBotAdapter.ts";

const AGENT_ID = "b47db307-2b88-4988-bb81-0d3c302355f3";

/**
 * Fake box: records gateway commands and lets the test push `/events`
 * frames. Payload shapes mirror what the real gateway emitted during the
 * exploratory session that this adapter was built against.
 */
const makeFakeClient = Effect.gen(function* () {
  const commands: Array<{ readonly command: string; readonly args: unknown }> = [];
  const failCommands = new Set<string>();
  // One queue per `/events` connection so a test can end the current feed
  // and watch the adapter reconnect and re-read the roster.
  let feed = yield* Queue.unbounded<GatewayEvent, Cause.Done>();
  /** One element per `/events` connection, so a test can wait for a (re)connect. */
  const connections = yield* Queue.unbounded<number>();
  let connectionCount = 0;
  const client: GrokBotClient = {
    api: () => Effect.succeed({}),
    ensureBox: Effect.succeed({
      gatewayUrl: "https://box.test",
      gatewayToken: "t",
      networkToken: "n",
    }),
    command: (command, args) =>
      Effect.suspend(() => {
        commands.push({ command, args });
        if (failCommands.has(command)) {
          return Effect.fail(
            new GrokBotGatewayError({ operation: `gateway/${command}`, detail: "box refused" }),
          );
        }
        return Effect.succeed(fakeReply(command));
      }),
    events: Stream.unwrap(
      Effect.gen(function* () {
        connectionCount += 1;
        yield* Queue.offer(connections, connectionCount);
        return Stream.fromQueue(feed);
      }),
    ),
  };
  const push = (channel: string, payload: unknown) => Queue.offer(feed, { channel, payload });
  const dropFeed = Effect.gen(function* () {
    const ended = feed;
    feed = yield* Queue.unbounded<GatewayEvent, Cause.Done>();
    yield* Queue.end(ended);
  });
  const awaitConnection = Queue.take(connections);
  return { client, commands, failCommands, push, dropFeed, awaitConnection };
});

function fakeReply(command: string): unknown {
  switch (command) {
    case "createAgent":
      return { agent: { id: AGENT_ID, name: "T3 Code thread" } };
    case "listAgents":
      return [{ id: AGENT_ID, isRunningTurn: false }];
    case "sendPrompt":
      return { accepted: true };
    case "interruptAgentRun":
      return { hadActiveRun: true };
    default:
      return {};
  }
}

const transcript = (entry: unknown) => ({ type: "appended", agentId: AGENT_ID, entry });
const roster = (isRunningTurn: boolean) => ({
  activeAgentId: AGENT_ID,
  agent: { id: AGENT_ID, name: "T3 Code thread", isRunning: isRunningTurn, isRunningTurn },
});

it.effect("creates a bot per thread and settles a turn from the box feed", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeClient;
    const adapter = yield* makeGrokBotAdapter(fake.client);
    const threadId = ThreadId.make("grok-bot-thread");
    const collected = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.threadId === threadId),
      Stream.takeUntil((event) => event.type === "turn.completed"),
      Stream.runCollect,
      Effect.forkChild,
    );

    const session = yield* adapter.startSession({
      threadId,
      provider: ProviderDriverKind.make("grokBot"),
      cwd: process.cwd(),
      title: "Fix the flaky test",
      runtimeMode: "full-access",
    });
    assert.deepEqual(session.resumeCursor, { schemaVersion: 1, agentId: AGENT_ID });
    const create = fake.commands.find((entry) => entry.command === "createAgent");
    assert.equal((create!.args as { name: string }).name, "Fix the flaky test");

    const turn = yield* adapter.sendTurn({ threadId, input: "Reply with exactly: pong" });
    const send = fake.commands.find((entry) => entry.command === "sendPrompt");
    assert.equal((send!.args as { prompt: string }).prompt, "Reply with exactly: pong");

    yield* fake.push("agent-upserted", roster(true));
    yield* fake.push("agent-activity", {
      agentId: AGENT_ID,
      live: { isRunning: true, activity: { kind: "shell", tool: "bash", detail: "git clone" } },
    });
    yield* fake.push(
      "transcript",
      transcript({ kind: "message", id: "t0u", role: "user", content: "Reply with exactly: pong" }),
    );
    // A row can be appended with partial text and updated with the rest; the
    // item stays open across the update and closes when the next row lands.
    yield* fake.push(
      "transcript",
      transcript({ kind: "send-message", id: "t0s0", message: { type: "text", content: "po" } }),
    );
    yield* fake.push("transcript", {
      ...transcript({
        kind: "send-message",
        id: "t0s0",
        message: { type: "text", content: "pong" },
      }),
      type: "updated",
    });
    yield* fake.push(
      "transcript",
      transcript({ kind: "send-message", id: "t0s1", message: { type: "text", content: "done" } }),
    );
    // A rewrite that is not a prefix extension cannot be streamed as a delta:
    // it closes the item and re-emits the full text as a new item.
    yield* fake.push("transcript", {
      ...transcript({
        kind: "send-message",
        id: "t0s1",
        message: { type: "text", content: "Done." },
      }),
      type: "updated",
    });
    yield* fake.push("agent-upserted", roster(false));

    const events = Array.from(yield* Fiber.join(collected));
    const types = events.map((event) => event.type);
    assert.deepEqual(types.slice(0, 4), [
      "session.started",
      "session.state.changed",
      "thread.started",
      "turn.started",
    ]);
    const assistant = events.filter(
      (event) =>
        (event.type === "item.started" || event.type === "item.completed") &&
        event.payload.itemType === "assistant_message",
    );
    assert.deepEqual(
      assistant.map((event) => `${event.type} ${event.itemId}`),
      [
        "item.started t0s0",
        "item.completed t0s0",
        "item.started t0s1",
        "item.completed t0s1",
        "item.started t0s1~2",
        "item.completed t0s1~2",
      ],
    );
    const deltas = events.filter((event) => event.type === "content.delta");
    assert.deepEqual(
      deltas.map((event) => (event.type === "content.delta" ? event.payload.delta : "")),
      ["po", "ng", "done", "Done."],
    );
    assert.equal(deltas[0]?.turnId, turn.turnId);
    const activity = events.find(
      (event) => event.type === "item.started" && event.payload.itemType === "dynamic_tool_call",
    );
    assert.equal(
      activity?.type === "item.started" ? activity.payload.title : undefined,
      "shell · bash: git clone",
    );
    const activityDone = events.find(
      (event) => event.type === "item.completed" && event.payload.itemType === "dynamic_tool_call",
    );
    assert.equal(activityDone?.turnId, turn.turnId);
    const completed = events.at(-1);
    assert.equal(
      completed?.type === "turn.completed" ? completed.payload.state : undefined,
      "completed",
    );
    assert.isFalse(
      yield* Effect.map(
        adapter.listSessions(),
        (sessions) => sessions[0]?.activeTurnId !== undefined,
      ),
    );

    yield* adapter.stopSession(threadId);
    assert.isFalse(yield* adapter.hasSession(threadId));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("closes an in-flight turn as interrupted when the session stops", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeClient;
    const adapter = yield* makeGrokBotAdapter(fake.client);
    const threadId = ThreadId.make("grok-bot-stop-midturn");
    const collected = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.threadId === threadId),
      Stream.takeUntil((event) => event.type === "session.exited"),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* adapter.startSession({ threadId, cwd: process.cwd(), runtimeMode: "full-access" });
    yield* adapter.sendTurn({ threadId, input: "keep going" });
    yield* adapter.stopSession(threadId);
    const types = Array.from(yield* Fiber.join(collected)).map((event) => event.type);
    assert.deepEqual(types.slice(-2), ["turn.completed", "session.exited"]);
    // The bot itself is left alone: it is the user's persistent teammate.
    assert.isUndefined(fake.commands.find((entry) => entry.command === "interruptAgentRun"));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("re-attaches to the bot in the resume cursor and auto-approves in full access", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeClient;
    const adapter = yield* makeGrokBotAdapter(fake.client);
    const threadId = ThreadId.make("grok-bot-resume");
    const collected = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.threadId === threadId),
      Stream.takeUntil((event) => event.type === "request.resolved"),
      Stream.runCollect,
      Effect.forkChild,
    );

    yield* adapter.startSession({
      threadId,
      cwd: process.cwd(),
      resumeCursor: { schemaVersion: 1, agentId: AGENT_ID },
      runtimeMode: "full-access",
    });
    assert.isUndefined(fake.commands.find((entry) => entry.command === "createAgent"));

    yield* adapter.sendTurn({ threadId, input: "Read my clipboard" });
    yield* fake.push(
      "transcript",
      transcript({
        kind: "send-message",
        id: "t2s1",
        message: {
          type: "local-tool-permission",
          ask: { requestId: "req-1", action: "run-command", target: "pbpaste", status: "always" },
        },
      }),
    );

    const events = Array.from(yield* Fiber.join(collected));
    const opened = events.find((event) => event.type === "request.opened");
    assert.equal(
      opened?.type === "request.opened" ? opened.payload.requestType : undefined,
      "command_execution_approval",
    );
    const resolve = fake.commands.find((entry) => entry.command === "resolveLocalToolPermission");
    assert.deepEqual(resolve?.args, {
      agentId: AGENT_ID,
      entryId: "t2s1",
      requestId: "req-1",
      resolution: "allow-once",
    });
    yield* adapter.stopSession(threadId);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("opens a new activity item when the tool changes without a callId", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeClient;
    const adapter = yield* makeGrokBotAdapter(fake.client);
    const threadId = ThreadId.make("grok-bot-activity");
    const collected = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.threadId === threadId),
      Stream.takeUntil((event) => event.type === "turn.completed"),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* adapter.startSession({ threadId, cwd: process.cwd(), runtimeMode: "full-access" });
    yield* adapter.sendTurn({ threadId, input: "clone and test" });
    yield* fake.push("agent-upserted", roster(true));
    yield* fake.push("agent-activity", {
      agentId: AGENT_ID,
      live: { activity: { tool: "bash", detail: "git clone" } },
    });
    yield* fake.push("agent-activity", {
      agentId: AGENT_ID,
      live: { activity: { tool: "bash", detail: "git clone" } },
    });
    yield* fake.push("agent-activity", {
      agentId: AGENT_ID,
      live: { activity: { tool: "browser", detail: "docs" } },
    });
    yield* fake.push("agent-activity", { agentId: AGENT_ID, live: null });
    yield* fake.push("agent-upserted", roster(false));

    const events = Array.from(yield* Fiber.join(collected));
    const activity = events
      .filter(
        (event) => event.type === "item.started" && event.payload.itemType === "dynamic_tool_call",
      )
      .map((event) => (event.type === "item.started" ? event.payload.title : ""));
    assert.deepEqual(activity, ["bash: git clone", "browser: docs"]);
    const completed = events.filter(
      (event) => event.type === "item.completed" && event.payload.itemType === "dynamic_tool_call",
    );
    assert.equal(completed.length, 2);
    yield* adapter.stopSession(threadId);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("restarts the shared event feed for a session started after the last one stopped", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeClient;
    const adapter = yield* makeGrokBotAdapter(fake.client);
    const first = ThreadId.make("grok-bot-first");
    yield* adapter.startSession({
      threadId: first,
      cwd: process.cwd(),
      runtimeMode: "full-access",
    });
    yield* adapter.stopSession(first);

    const second = ThreadId.make("grok-bot-second");
    const collected = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.threadId === second),
      Stream.takeUntil((event) => event.type === "turn.completed"),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* adapter.startSession({
      threadId: second,
      cwd: process.cwd(),
      runtimeMode: "full-access",
    });
    yield* adapter.sendTurn({ threadId: second, input: "ping" });
    yield* fake.push("agent-upserted", roster(true));
    yield* fake.push("agent-upserted", roster(false));
    const events = Array.from(yield* Fiber.join(collected));
    assert.equal(events.at(-1)?.type, "turn.completed");
    yield* adapter.stopSession(second);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("holds the turn open on an unanswered approval and settles once it is answered", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeClient;
    fake.failCommands.add("resolveAutoReviewApproval");
    const adapter = yield* makeGrokBotAdapter(fake.client);
    const threadId = ThreadId.make("grok-bot-approval-only");
    const warned = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.threadId === threadId && event.type === "runtime.warning"),
      Stream.take(1),
      Stream.runCollect,
      Effect.forkChild,
    );
    const collected = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.threadId === threadId),
      Stream.takeUntil((event) => event.type === "turn.completed"),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* adapter.startSession({ threadId, cwd: process.cwd(), runtimeMode: "full-access" });
    yield* adapter.sendTurn({ threadId, input: "archive everything" });
    // The auto-approve fails, so the card stays open as a mid-run gate.
    yield* fake.push(
      "transcript",
      transcript({
        kind: "send-message",
        id: "t4s0",
        message: {
          type: "auto-review-approval",
          approval: { requestId: "ar-2", summary: "Archive" },
        },
      }),
    );
    yield* Fiber.join(warned);
    // Idle while the gate is open does not settle the turn.
    yield* fake.push("agent-upserted", roster(false));
    assert.isTrue(
      yield* Effect.map(
        adapter.listSessions(),
        (sessions) => sessions[0]?.activeTurnId !== undefined,
      ),
    );

    // Answered by hand: the box resumes, then finishes.
    fake.failCommands.clear();
    yield* adapter.respondToRequest(threadId, ApprovalRequestId.make("t4s0"), "accept");
    assert.equal(
      fake.commands.filter((entry) => entry.command === "resolveAutoReviewApproval").length,
      2,
    );
    yield* fake.push("agent-upserted", roster(false));

    const events = Array.from(yield* Fiber.join(collected));
    const types = events.map((event) => event.type);
    assert.include(types, "request.opened");
    assert.include(types, "runtime.warning");
    assert.include(types, "request.resolved");
    assert.equal(events.at(-1)?.type, "turn.completed");
    yield* adapter.stopSession(threadId);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("settles a dispatched turn from the roster after the feed reconnects", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeClient;
    const adapter = yield* makeGrokBotAdapter(fake.client);
    const threadId = ThreadId.make("grok-bot-reconnect");
    const collected = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.threadId === threadId),
      Stream.takeUntil((event) => event.type === "turn.completed"),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* adapter.startSession({ threadId, cwd: process.cwd(), runtimeMode: "full-access" });
    yield* adapter.sendTurn({ threadId, input: "long job" });
    // The feed dies before any running flag or reply arrived; the bot finishes
    // while we are disconnected, so the reconnect's roster read shows idle.
    yield* fake.awaitConnection;
    yield* fake.dropFeed;
    // Drive the virtual clock through the reconnect backoff until the turn settles.
    const events = Array.from(
      yield* Fiber.join(collected).pipe(
        Effect.race(
          Effect.forever(TestClock.adjust("1 second").pipe(Effect.andThen(Effect.yieldNow))),
        ),
      ),
    );
    assert.equal(events.at(-1)?.type, "turn.completed");
    yield* adapter.stopSession(threadId);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("keeps a widget answerable when the box rejects the answer", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeClient;
    const adapter = yield* makeGrokBotAdapter(fake.client);
    const threadId = ThreadId.make("grok-bot-widget");
    const asked = yield* adapter.streamEvents.pipe(
      Stream.filter(
        (event) => event.threadId === threadId && event.type === "user-input.requested",
      ),
      Stream.take(1),
      Stream.runCollect,
      Effect.forkChild,
    );
    yield* adapter.startSession({ threadId, cwd: process.cwd(), runtimeMode: "full-access" });
    yield* adapter.sendTurn({ threadId, input: "pick one" });
    yield* fake.push(
      "transcript",
      transcript({
        kind: "send-message",
        id: "t5s0",
        message: {
          type: "widget",
          widget: { prompt: "Resume?", options: [{ label: "Yes", value: "yes" }] },
        },
      }),
    );
    const [request] = Array.from(yield* Fiber.join(asked));
    const requestId = ApprovalRequestId.make(request!.requestId!);

    fake.failCommands.add("respondToWidget");
    const failed = yield* adapter
      .respondToUserInput(threadId, requestId, { t5s0: "yes" })
      .pipe(Effect.flip);
    assert.equal(failed._tag, "ProviderAdapterRequestError");

    fake.failCommands.clear();
    yield* adapter.respondToUserInput(threadId, requestId, { t5s0: "yes" });
    assert.equal(fake.commands.filter((entry) => entry.command === "respondToWidget").length, 2);
    yield* adapter.stopSession(threadId);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("attaches an existing bot via /resume and rejects unknown ids", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeClient;
    const adapter = yield* makeGrokBotAdapter(fake.client);
    const session = yield* adapter.startSession({
      threadId: ThreadId.make("grok-bot-native"),
      cwd: process.cwd(),
      nativeSessionId: AGENT_ID,
      runtimeMode: "full-access",
    });
    assert.deepEqual(session.resumeCursor, { schemaVersion: 1, agentId: AGENT_ID });
    assert.isUndefined(fake.commands.find((entry) => entry.command === "createAgent"));

    const missing = yield* adapter
      .startSession({
        threadId: ThreadId.make("grok-bot-native-missing"),
        cwd: process.cwd(),
        nativeSessionId: "not-a-bot",
        runtimeMode: "full-access",
      })
      .pipe(Effect.flip);
    assert.equal(missing._tag, "ProviderAdapterValidationError");
    assert.isUndefined(fake.commands.find((entry) => entry.command === "createAgent"));

    // A bot is bound to one thread at a time.
    const taken = yield* adapter
      .startSession({
        threadId: ThreadId.make("grok-bot-native-second"),
        cwd: process.cwd(),
        nativeSessionId: AGENT_ID,
        runtimeMode: "full-access",
      })
      .pipe(Effect.flip);
    assert.equal(taken._tag, "ProviderAdapterValidationError");
    yield* adapter.stopAll();
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("forwards approvals to the user outside full access and honors the answer", () =>
  Effect.gen(function* () {
    const fake = yield* makeFakeClient;
    const adapter = yield* makeGrokBotAdapter(fake.client);
    const threadId = ThreadId.make("grok-bot-approval");
    const opened = yield* adapter.streamEvents.pipe(
      Stream.filter((event) => event.threadId === threadId && event.type === "request.opened"),
      Stream.take(1),
      Stream.runCollect,
      Effect.forkChild,
    );

    yield* adapter.startSession({ threadId, cwd: process.cwd(), runtimeMode: "approval-required" });
    yield* adapter.sendTurn({ threadId, input: "Archive my inbox" });
    yield* fake.push(
      "transcript",
      transcript({
        kind: "send-message",
        id: "t3s2",
        message: {
          type: "auto-review-approval",
          approval: {
            requestId: "ar-1",
            surface: "subagent",
            summary: "Launch an executor subagent",
          },
        },
      }),
    );
    const [request] = Array.from(yield* Fiber.join(opened));
    assert.isUndefined(
      fake.commands.find((entry) => entry.command === "resolveAutoReviewApproval"),
    );

    // The box has no cancel; an abandoned card is delivered as a denial so the
    // bot is not left waiting on it.
    yield* adapter.respondToRequest(
      threadId,
      ApprovalRequestId.make(request!.requestId!),
      "cancel",
    );
    const resolve = fake.commands.find((entry) => entry.command === "resolveAutoReviewApproval");
    assert.equal((resolve!.args as { resolution: string }).resolution, "denied");
    yield* adapter.stopSession(threadId);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it("strips credentials from HTTPS remotes and leaves scp-like remotes alone", () => {
  assert.equal(
    withoutRemoteCredentials("https://x-access-token:ghp_secret@github.com/o/r.git"),
    "https://github.com/o/r.git",
  );
  assert.equal(
    withoutRemoteCredentials("https://ghp_secret@github.com/o/r.git"),
    "https://github.com/o/r.git",
  );
  assert.equal(withoutRemoteCredentials("git@github.com:o/r.git"), "git@github.com:o/r.git");
  assert.equal(
    withoutRemoteCredentials("ssh://git@github.com/o/r.git"),
    "ssh://git@github.com/o/r.git",
  );
  assert.equal(
    withoutRemoteCredentials("ssh://git:pw@github.com/o/r.git"),
    "ssh://git@github.com/o/r.git",
  );
});
