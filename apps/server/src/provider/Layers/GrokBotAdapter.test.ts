import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ApprovalRequestId, ProviderDriverKind, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import type { GatewayEvent, GrokBotClient } from "../grokBot/GrokBotGateway.ts";
import { makeGrokBotAdapter } from "./GrokBotAdapter.ts";

const AGENT_ID = "b47db307-2b88-4988-bb81-0d3c302355f3";

/**
 * Fake box: records gateway commands and lets the test push `/events`
 * frames. Payload shapes mirror what the real gateway emitted during the
 * exploratory session that this adapter was built against.
 */
const makeFakeClient = Effect.gen(function* () {
  const commands: Array<{ readonly command: string; readonly args: unknown }> = [];
  const feed = yield* Queue.unbounded<GatewayEvent>();
  const client: GrokBotClient = {
    api: () => Effect.succeed({}),
    ensureBox: Effect.succeed({
      gatewayUrl: "https://box.test",
      gatewayToken: "t",
      networkToken: "n",
    }),
    command: (command, args) =>
      Effect.sync(() => {
        commands.push({ command, args });
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
      }),
    events: Stream.fromQueue(feed),
  };
  const push = (channel: string, payload: unknown) => Queue.offer(feed, { channel, payload });
  return { client, commands, push };
});

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
