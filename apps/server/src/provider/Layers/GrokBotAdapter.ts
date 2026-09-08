/**
 * GrokBotAdapter — drives a Grok Bot on the user's Cursor cloud box.
 *
 * One T3 thread owns one bot. A session creates the bot through the box
 * gateway (or re-attaches to the bot recorded in the resume cursor), a turn
 * is one `sendPrompt`, and the box's `/events` feed supplies the transcript,
 * live tool activity, and the running/idle flag that settles the turn. The
 * feed is box-wide, so the adapter holds a single connection shared by every
 * session and routes by agent id.
 *
 * Nothing runs on this machine: the bot clones repositories onto its own
 * computer, so there is no local diff or checkpoint for these turns.
 *
 * @module GrokBotAdapter
 */
import {
  ApprovalRequestId,
  EventId,
  GROK_BOT_MODEL,
  type ProviderApprovalDecision,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  RuntimeItemId,
  RuntimeRequestId,
  type RuntimeMode,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as KeyedLock from "../../KeyedLock.ts";
import {
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
  type ProviderAdapterError,
} from "../Errors.ts";
import {
  describeActivity,
  gatewaySignals,
  type GrokBotBotMessageEntry,
  type GrokBotGatewaySignal,
} from "../grokBot/GrokBotEvents.ts";
import { type GrokBotClient, GrokBotGatewayError } from "../grokBot/GrokBotGateway.ts";
import { spawnAndCollect } from "../providerSnapshot.ts";
import type { ProviderAdapterShape } from "../Services/ProviderAdapter.ts";

const PROVIDER = ProviderDriverKind.make("grokBot");
const RUNTIME_EVENT_BUFFER_CAPACITY = 512;
const RESUME_VERSION = 1 as const;
const RAW_SOURCE = "grokBot.gateway" as const;
const EVENTS_RECONNECT_MIN_MS = 1_000;
const EVENTS_RECONNECT_MAX_MS = 30_000;
const BOT_NAME_MAX_LENGTH = 60;

export interface GrokBotAdapterShape extends ProviderAdapterShape<ProviderAdapterError> {}

export interface GrokBotAdapterOptions {
  readonly instanceId?: ProviderInstanceId;
  readonly environment?: NodeJS.ProcessEnv;
}

const ResumeCursor = Schema.Struct({
  schemaVersion: Schema.Literal(RESUME_VERSION),
  agentId: Schema.String,
});
const decodeResume = Schema.decodeUnknownOption(ResumeCursor);

const decodeCreateAgent = Schema.decodeUnknownOption(
  Schema.Struct({ agent: Schema.Struct({ id: Schema.String }) }),
);
const decodeSendPrompt = Schema.decodeUnknownOption(
  Schema.Struct({ accepted: Schema.optional(Schema.Boolean) }),
);
const decodeInterrupt = Schema.decodeUnknownOption(
  Schema.Struct({ hadActiveRun: Schema.optional(Schema.Boolean) }),
);
const decodeListAgents = Schema.decodeUnknownOption(
  Schema.Array(
    Schema.Struct({ id: Schema.String, isRunningTurn: Schema.optional(Schema.Boolean) }),
  ),
);

type PendingRequest =
  | { readonly kind: "local-tool"; readonly entryId: string; readonly requestId: string }
  | { readonly kind: "auto-review"; readonly entryId: string; readonly requestId: string };

interface ActiveTurn {
  readonly turnId: TurnId;
  readonly clientNonce: string;
  /** Box reported the turn running; the next idle flag settles it. */
  sawRunning: boolean;
  /** A bot message for this turn arrived — enough to settle on idle even if
   * the running flag was missed across an event-feed reconnect. */
  gotReply: boolean;
  interrupted: boolean;
}

interface SessionContext {
  readonly threadId: ThreadId;
  readonly agentId: string;
  session: ProviderSession;
  activeTurn: ActiveTurn | undefined;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly pendingRequests: Map<ApprovalRequestId, PendingRequest>;
  readonly pendingUserInputs: Map<ApprovalRequestId, { readonly entryId: string }>;
  /** Assistant text already emitted per transcript entry, for delta updates. */
  readonly emittedText: Map<string, string>;
  /** Transcript entry whose assistant item is still streaming. A row may be
   * appended and then updated with more text, so the item stays open until
   * another entry arrives or the turn settles. */
  openAssistantEntryId: string | undefined;
  activityItemId: string | undefined;
  stopped: boolean;
}

function autoApproves(mode: RuntimeMode): boolean {
  return mode === "full-access" || mode === "auto";
}

function botName(title: string | undefined): string {
  const trimmed = title?.trim().replace(/\s+/g, " ");
  if (!trimmed) return "T3 Code thread";
  return trimmed.length > BOT_NAME_MAX_LENGTH
    ? `${trimmed.slice(0, BOT_NAME_MAX_LENGTH - 1)}…`
    : trimmed;
}

function botDescription(input: {
  readonly title: string | undefined;
  readonly cwd: string;
  readonly remote: string | undefined;
  readonly branch: string | undefined;
}): string {
  const lines = [
    "You are a coding teammate driven from T3 Code. The user talks to you from a T3 Code thread; everything you say is shown there.",
    `Local project directory on the user's machine: ${input.cwd}`,
  ];
  if (input.remote) {
    lines.push(
      `Git remote: ${input.remote}${input.branch ? ` (current branch: ${input.branch})` : ""}.`,
      "Clone the repository on your own computer when you need the code. Work on a branch, push it, and report back with the branch or pull request link. Ask the user for repository access if the clone fails.",
    );
  } else {
    lines.push(
      "The project has no git remote you can reach. Start new work on your own computer and share it back through git or files.",
    );
  }
  if (input.title?.trim()) lines.push(`Thread: ${input.title.trim()}`);
  return lines.join("\n");
}

const gitOutput = (cwd: string, args: ReadonlyArray<string>, env: NodeJS.ProcessEnv | undefined) =>
  spawnAndCollect("git", ChildProcess.make("git", [...args], { cwd, env })).pipe(
    Effect.map((result) => (result.code === 0 ? result.stdout.trim() || undefined : undefined)),
    Effect.orElseSucceed(() => undefined),
  );

export function makeGrokBotAdapter(client: GrokBotClient, options?: GrokBotAdapterOptions) {
  return Effect.gen(function* () {
    const boundInstanceId = options?.instanceId ?? ProviderInstanceId.make("grokBot");
    const crypto = yield* Crypto.Crypto;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const sessions = new Map<ThreadId, SessionContext>();
    const sessionsByAgent = new Map<string, SessionContext>();
    const threadLocks = yield* KeyedLock.make;
    const runtimeEventPubSub = yield* PubSub.bounded<ProviderRuntimeEvent>(
      RUNTIME_EVENT_BUFFER_CAPACITY,
    );
    // Owns the shared event-feed fiber; closed with the adapter.
    const adapterScope = yield* Scope.make();
    yield* Effect.addFinalizer(() => Scope.close(adapterScope, Exit.void));
    let eventsFiber: Fiber.Fiber<void, never> | undefined;

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const randomUUIDv4 = crypto.randomUUIDv4.pipe(
      Effect.mapError(
        (cause) =>
          new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "crypto/randomUUIDv4",
            detail: "Failed to generate Grok Bot runtime identifier.",
            cause,
          }),
      ),
    );
    const makeEventStamp = () =>
      Effect.all({ eventId: Effect.map(randomUUIDv4, EventId.make), createdAt: nowIso });
    const emit = (event: ProviderRuntimeEvent) =>
      PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);

    const mapGatewayError = (method: string) => (cause: GrokBotGatewayError) =>
      new ProviderAdapterRequestError({ provider: PROVIDER, method, detail: cause.message, cause });

    const requireSession = (threadId: ThreadId) => {
      const ctx = sessions.get(threadId);
      return !ctx || ctx.stopped
        ? Effect.fail(new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }))
        : Effect.succeed(ctx);
    };

    // ── turn settlement ──────────────────────────────────────────────

    const completeActivity = (ctx: SessionContext) =>
      Effect.gen(function* () {
        if (!ctx.activityItemId) return;
        const itemId = ctx.activityItemId;
        ctx.activityItemId = undefined;
        yield* emit({
          type: "item.completed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          turnId: ctx.activeTurn?.turnId,
          itemId: RuntimeItemId.make(itemId),
          payload: { itemType: "dynamic_tool_call", status: "completed" },
        });
      });

    const completeAssistantItem = (ctx: SessionContext) =>
      Effect.gen(function* () {
        const entryId = ctx.openAssistantEntryId;
        if (!entryId) return;
        ctx.openAssistantEntryId = undefined;
        yield* emit({
          type: "item.completed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          turnId: ctx.activeTurn?.turnId,
          itemId: RuntimeItemId.make(entryId),
          payload: { itemType: "assistant_message", status: "completed" },
        });
      });

    const settleTurn = (
      ctx: SessionContext,
      state: "completed" | "interrupted" | "failed",
      errorMessage?: string,
    ) =>
      Effect.gen(function* () {
        const turn = ctx.activeTurn;
        if (!turn) return;
        yield* completeAssistantItem(ctx);
        ctx.activeTurn = undefined;
        yield* completeActivity(ctx);
        ctx.session = { ...ctx.session, activeTurnId: undefined, updatedAt: yield* nowIso };
        yield* emit({
          type: "turn.completed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          turnId: turn.turnId,
          payload: {
            state,
            stopReason: state === "completed" ? "end_turn" : state,
            ...(errorMessage ? { errorMessage } : {}),
          },
        });
      });

    // ── gateway signal handling ──────────────────────────────────────

    const handleAssistantText = (
      ctx: SessionContext,
      entryId: string,
      content: string,
      raw: unknown,
    ) =>
      Effect.gen(function* () {
        const previous = ctx.emittedText.get(entryId);
        const delta =
          previous === undefined
            ? content
            : content.startsWith(previous)
              ? content.slice(previous.length)
              : "";
        if (previous !== undefined && !delta) return;
        ctx.emittedText.set(entryId, content);
        const turnId = ctx.activeTurn?.turnId;
        if (ctx.activeTurn) ctx.activeTurn.gotReply = true;
        const itemId = RuntimeItemId.make(entryId);
        if (previous === undefined) {
          if (ctx.openAssistantEntryId !== entryId) yield* completeAssistantItem(ctx);
          ctx.openAssistantEntryId = entryId;
          yield* emit({
            type: "item.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: ctx.threadId,
            turnId,
            itemId,
            payload: { itemType: "assistant_message", status: "inProgress" },
          });
        }
        if (delta) {
          yield* emit({
            type: "content.delta",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: ctx.threadId,
            turnId,
            itemId,
            payload: { streamKind: "assistant_text", delta },
            raw: { source: RAW_SOURCE, method: "transcript", payload: raw },
          });
        }
      });

    const handleWidget = (
      ctx: SessionContext,
      entryId: string,
      widget: Extract<GrokBotBotMessageEntry["message"], { type: "widget" }>["widget"],
      raw: unknown,
    ) =>
      Effect.gen(function* () {
        if (ctx.emittedText.has(entryId)) return;
        ctx.emittedText.set(entryId, widget.prompt);
        const requestId = ApprovalRequestId.make(entryId);
        ctx.pendingUserInputs.set(requestId, { entryId });
        yield* emit({
          type: "user-input.requested",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          turnId: ctx.activeTurn?.turnId,
          requestId: RuntimeRequestId.make(requestId),
          payload: {
            questions: [
              {
                id: entryId,
                header: "Grok Bot",
                question: widget.prompt,
                options: (widget.options ?? []).map((option) => ({
                  label: option.label,
                  description: "",
                  value: option.value,
                })),
                allowCustomAnswer: (widget.options ?? []).length === 0,
                multiSelect: false,
              },
            ],
          },
          raw: { source: RAW_SOURCE, method: "transcript", payload: raw },
        });
      });

    const resolveRequest = (
      ctx: SessionContext,
      pending: PendingRequest,
      decision: ProviderApprovalDecision,
    ) => {
      const approve =
        decision === "accept" || decision === "acceptForSession" || decision === "acceptAlways";
      const always = decision === "acceptAlways";
      return pending.kind === "local-tool"
        ? client.command("resolveLocalToolPermission", {
            agentId: ctx.agentId,
            entryId: pending.entryId,
            requestId: pending.requestId,
            resolution: approve ? (always ? "always" : "allow-once") : "deny",
          })
        : client.command("resolveAutoReviewApproval", {
            agentId: ctx.agentId,
            entryId: pending.entryId,
            requestId: pending.requestId,
            resolution: approve ? (always ? "always" : "approved") : "denied",
            approvalPlatform: "desktop",
          });
    };

    const handleApprovalAsk = (
      ctx: SessionContext,
      entryId: string,
      pending: PendingRequest,
      detail: string,
      raw: unknown,
    ) =>
      Effect.gen(function* () {
        if (ctx.emittedText.has(entryId)) return;
        ctx.emittedText.set(entryId, detail);
        const requestId = ApprovalRequestId.make(entryId);
        const runtimeRequestId = RuntimeRequestId.make(requestId);
        const requestType =
          pending.kind === "local-tool" ? "command_execution_approval" : "dynamic_tool_call";
        const askUser = !autoApproves(ctx.session.runtimeMode);
        // Register before publishing so a fast client answer finds the request.
        if (askUser) ctx.pendingRequests.set(requestId, pending);
        yield* emit({
          type: "request.opened",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          turnId: ctx.activeTurn?.turnId,
          requestId: runtimeRequestId,
          payload: {
            requestType,
            detail,
            options: [
              {
                decision: "accept",
                label: pending.kind === "local-tool" ? "Allow once" : "Approve",
              },
              { decision: "acceptAlways", label: "Always" },
              { decision: "decline", label: "Deny" },
            ],
          },
          raw: { source: RAW_SOURCE, method: "transcript", payload: raw },
        });
        if (askUser) return;
        yield* resolveRequest(ctx, pending, "accept").pipe(
          Effect.catch((cause) => Effect.logWarning("Grok Bot auto-approval failed", { cause })),
        );
        yield* emit({
          type: "request.resolved",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          turnId: ctx.activeTurn?.turnId,
          requestId: runtimeRequestId,
          payload: { requestType, decision: "accept" },
        });
      });

    const handleBotMessage = (ctx: SessionContext, entry: GrokBotBotMessageEntry, raw: unknown) =>
      Effect.gen(function* () {
        const message = entry.message;
        // Any non-text card ends the assistant message that preceded it.
        if (message.type !== "text") yield* completeAssistantItem(ctx);
        switch (message.type) {
          case "text":
            return yield* handleAssistantText(ctx, entry.id, message.content, raw);
          case "widget":
            return yield* handleWidget(ctx, entry.id, message.widget, raw);
          case "local-tool-permission":
            return yield* handleApprovalAsk(
              ctx,
              entry.id,
              { kind: "local-tool", entryId: entry.id, requestId: message.ask.requestId },
              `Run on your computer: ${message.ask.target ?? message.ask.action ?? "command"}`,
              raw,
            );
          case "auto-review-approval":
            return yield* handleApprovalAsk(
              ctx,
              entry.id,
              { kind: "auto-review", entryId: entry.id, requestId: message.approval.requestId },
              message.approval.summary ?? `Approve ${message.approval.surface ?? "action"}`,
              raw,
            );
          default:
            return;
        }
      });

    const handleRunning = (ctx: SessionContext, isRunningTurn: boolean) =>
      Effect.gen(function* () {
        const turn = ctx.activeTurn;
        if (!turn) return;
        if (isRunningTurn) {
          turn.sawRunning = true;
          return;
        }
        if (turn.sawRunning || turn.gotReply) {
          yield* settleTurn(ctx, turn.interrupted ? "interrupted" : "completed");
        }
      });

    const handleActivity = (
      ctx: SessionContext,
      activity: Extract<GrokBotGatewaySignal, { _tag: "activity" }>,
    ) =>
      Effect.gen(function* () {
        const live = activity.activity;
        if (!live) return yield* completeActivity(ctx);
        const itemId = live.callId?.trim() || `activity-${ctx.agentId}`;
        if (ctx.activityItemId === itemId) return;
        yield* completeActivity(ctx);
        ctx.activityItemId = itemId;
        yield* emit({
          type: "item.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          turnId: ctx.activeTurn?.turnId,
          itemId: RuntimeItemId.make(itemId),
          payload: {
            itemType: "dynamic_tool_call",
            status: "inProgress",
            title: describeActivity(live),
            toolSurface: "computer",
          },
          raw: { source: RAW_SOURCE, method: "agent-activity", payload: live },
        });
      });

    const handleSignal = (signal: GrokBotGatewaySignal, raw: unknown) => {
      const agentId = signal._tag === "agent" ? signal.agent.id : signal.agentId;
      const ctx = sessionsByAgent.get(agentId);
      if (!ctx || ctx.stopped) return Effect.void;
      switch (signal._tag) {
        case "bot-message":
          return handleBotMessage(ctx, signal.entry, raw);
        case "agent":
          return signal.agent.isRunningTurn === undefined
            ? Effect.void
            : handleRunning(ctx, signal.agent.isRunningTurn);
        case "activity":
          return handleActivity(ctx, signal);
      }
    };

    /** After (re)connecting, re-read the roster so a running flag missed
     * while disconnected still settles the turn. */
    const resyncRoster = client.command("listAgents", {}).pipe(
      Effect.flatMap((raw) => {
        const agents = decodeListAgents(raw);
        if (agents._tag === "None") return Effect.void;
        return Effect.forEach(
          agents.value,
          (agent) => handleSignal({ _tag: "agent", agent }, raw),
          { discard: true },
        );
      }),
      Effect.catch((cause) => Effect.logWarning("Grok Bot roster resync failed", { cause })),
    );

    const runEventsOnce = client.events.pipe(
      Stream.runForEach((event) =>
        Effect.forEach(gatewaySignals(event), (signal) => handleSignal(signal, event.payload), {
          discard: true,
        }),
      ),
    );

    const eventsLoop = Effect.gen(function* () {
      let backoffMs = EVENTS_RECONNECT_MIN_MS;
      while (sessions.size > 0) {
        yield* resyncRoster;
        const startedAt = yield* Clock.currentTimeMillis;
        yield* runEventsOnce.pipe(
          Effect.catch((cause) => Effect.logWarning("Grok Bot event feed ended", { cause })),
        );
        if (sessions.size === 0) break;
        // A feed that lived a while resets the backoff; rapid failures grow it.
        const endedAt = yield* Clock.currentTimeMillis;
        backoffMs =
          endedAt - startedAt > EVENTS_RECONNECT_MAX_MS
            ? EVENTS_RECONNECT_MIN_MS
            : Math.min(backoffMs * 2, EVENTS_RECONNECT_MAX_MS);
        yield* Effect.sleep(backoffMs);
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          eventsFiber = undefined;
        }),
      ),
    );

    const ensureEventsLoop = Effect.gen(function* () {
      if (eventsFiber) return;
      eventsFiber = yield* Effect.forkIn(eventsLoop, adapterScope);
    });

    // ── adapter surface ──────────────────────────────────────────────

    const stopSessionInternal = (ctx: SessionContext) =>
      Effect.gen(function* () {
        if (ctx.stopped) return;
        ctx.stopped = true;
        sessions.delete(ctx.threadId);
        sessionsByAgent.delete(ctx.agentId);
        ctx.pendingRequests.clear();
        ctx.pendingUserInputs.clear();
        if (sessions.size === 0 && eventsFiber) {
          yield* Fiber.interrupt(eventsFiber);
          eventsFiber = undefined;
        }
        yield* emit({
          type: "session.exited",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          payload: { exitKind: "graceful" },
        });
      });

    const findAgent = (agentId: string) =>
      client.command("listAgents", {}).pipe(
        Effect.map((raw) => {
          const agents = decodeListAgents(raw);
          return agents._tag === "Some"
            ? agents.value.find((agent) => agent.id === agentId)
            : undefined;
        }),
      );

    const createAgent = (input: { readonly title: string | undefined; readonly cwd: string }) =>
      Effect.gen(function* () {
        const [remote, branch] = yield* Effect.all([
          gitOutput(input.cwd, ["remote", "get-url", "origin"], options?.environment),
          gitOutput(input.cwd, ["rev-parse", "--abbrev-ref", "HEAD"], options?.environment),
        ]).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));
        const raw = yield* client.command("createAgent", {
          name: botName(input.title ?? path.basename(input.cwd)),
          description: botDescription({ title: input.title, cwd: input.cwd, remote, branch }),
          clientNonce: yield* randomUUIDv4,
          isIntroductionSuppressed: true,
          isKickstartRequested: false,
          origin: "user",
          creationRoute: { kind: "box" },
          supportsTemporalHarness: true,
        });
        const decoded = decodeCreateAgent(raw);
        if (decoded._tag === "None") {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "gateway/createAgent",
            detail: "The box did not return the new bot.",
          });
        }
        return decoded.value.agent.id;
      });

    const startSession: GrokBotAdapterShape["startSession"] = (input) =>
      threadLocks.withLock(
        input.threadId,
        Effect.gen(function* () {
          if (input.provider !== undefined && input.provider !== PROVIDER) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
            });
          }
          if (!input.cwd?.trim()) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: "cwd is required and must be non-empty.",
            });
          }
          const cwd = path.resolve(input.cwd.trim());
          const existing = sessions.get(input.threadId);
          if (existing && !existing.stopped) yield* stopSessionInternal(existing);

          const resumeAgentId =
            input.nativeSessionId ??
            (() => {
              const cursor = decodeResume(input.resumeCursor);
              return cursor._tag === "Some" ? cursor.value.agentId : undefined;
            })();
          const resumed = resumeAgentId
            ? yield* findAgent(resumeAgentId).pipe(
                Effect.mapError(mapGatewayError("gateway/listAgents")),
              )
            : undefined;
          const agentId = resumed
            ? resumed.id
            : yield* createAgent({ title: input.title, cwd }).pipe(
                Effect.catchTag("GrokBotGatewayError", (cause) =>
                  Effect.fail(mapGatewayError("gateway/createAgent")(cause)),
                ),
              );

          const now = yield* nowIso;
          const session: ProviderSession = {
            provider: PROVIDER,
            providerInstanceId: boundInstanceId,
            status: "ready",
            runtimeMode: input.runtimeMode,
            cwd,
            model: GROK_BOT_MODEL,
            threadId: input.threadId,
            resumeCursor: { schemaVersion: RESUME_VERSION, agentId },
            createdAt: now,
            updatedAt: now,
          };
          const ctx: SessionContext = {
            threadId: input.threadId,
            agentId,
            session,
            activeTurn: undefined,
            turns: [],
            pendingRequests: new Map(),
            pendingUserInputs: new Map(),
            emittedText: new Map(),
            openAssistantEntryId: undefined,
            activityItemId: undefined,
            stopped: false,
          };
          sessions.set(input.threadId, ctx);
          sessionsByAgent.set(agentId, ctx);
          yield* ensureEventsLoop;

          yield* emit({
            type: "session.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: {
              message: resumed ? "Re-attached to Grok Bot" : "Created a Grok Bot for this thread",
              resume: session.resumeCursor,
            },
          });
          yield* emit({
            type: "session.state.changed",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { state: "ready", reason: "Grok Bot box gateway connected" },
          });
          yield* emit({
            type: "thread.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { providerThreadId: agentId },
          });
          return session;
        }),
      );

    const sendTurn: GrokBotAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        const text = input.input?.trim();
        if (!text) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Turn requires non-empty text.",
          });
        }
        // A prompt while the bot is still working is a steer: the box folds it
        // into the running turn, so the active turn id is reused.
        const steering = ctx.activeTurn;
        const turnId = steering?.turnId ?? TurnId.make(yield* randomUUIDv4);
        const clientNonce = yield* randomUUIDv4;
        if (!steering) {
          ctx.activeTurn = {
            turnId,
            clientNonce,
            sawRunning: false,
            gotReply: false,
            interrupted: false,
          };
          ctx.session = { ...ctx.session, activeTurnId: turnId, updatedAt: yield* nowIso };
          yield* emit({
            type: "turn.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
            payload: { model: GROK_BOT_MODEL },
          });
        }
        if (input.attachments && input.attachments.length > 0) {
          yield* emit({
            type: "runtime.warning",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
            payload: {
              message: "Grok Bot turns do not carry attachments yet; only the text was sent.",
            },
          });
        }
        const composedAtMs = yield* Clock.currentTimeMillis;
        const sent = yield* client
          .command("sendPrompt", {
            agentId: ctx.agentId,
            prompt: text,
            clientNonce,
            source: "desktop",
            composedAtMs,
          })
          .pipe(Effect.result);
        if (sent._tag === "Failure") {
          if (!steering) yield* settleTurn(ctx, "failed", sent.failure.message);
          return yield* mapGatewayError("gateway/sendPrompt")(sent.failure);
        }
        const raw = sent.success;
        const accepted = decodeSendPrompt(raw);
        if (accepted._tag === "Some" && accepted.value.accepted === false) {
          yield* settleTurn(ctx, "failed", "The bot refused the message.");
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "gateway/sendPrompt",
            detail: "The bot refused the message.",
          });
        }
        const turnRecord = ctx.turns.find((turn) => turn.id === turnId);
        if (turnRecord) turnRecord.items.push({ prompt: text });
        else ctx.turns.push({ id: turnId, items: [{ prompt: text }] });
        return { threadId: input.threadId, turnId, resumeCursor: ctx.session.resumeCursor };
      });

    const interruptTurn: GrokBotAdapterShape["interruptTurn"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const turn = ctx.activeTurn;
        if (!turn) return;
        turn.interrupted = true;
        const raw = yield* client
          .command("interruptAgentRun", { id: ctx.agentId })
          .pipe(Effect.mapError(mapGatewayError("gateway/interruptAgentRun")));
        const decoded = decodeInterrupt(raw);
        if (decoded._tag === "Some" && decoded.value.hadActiveRun === false) {
          yield* settleTurn(ctx, "interrupted");
        }
      });

    const respondToRequest: GrokBotAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingRequests.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "gateway/resolveApproval",
            detail: `Unknown pending approval request: ${requestId}`,
          });
        }
        ctx.pendingRequests.delete(requestId);
        if (decision !== "cancel") {
          yield* resolveRequest(ctx, pending, decision).pipe(
            Effect.mapError(mapGatewayError("gateway/resolveApproval")),
          );
        }
        yield* emit({
          type: "request.resolved",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId,
          turnId: ctx.activeTurn?.turnId,
          requestId: RuntimeRequestId.make(requestId),
          payload: {
            requestType:
              pending.kind === "local-tool" ? "command_execution_approval" : "dynamic_tool_call",
            decision,
          },
        });
      });

    const respondToUserInput: GrokBotAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      answers,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingUserInputs.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "gateway/respondToWidget",
            detail: `Unknown pending user-input request: ${requestId}`,
          });
        }
        ctx.pendingUserInputs.delete(requestId);
        const value = firstAnswer(answers);
        if (value) {
          yield* client
            .command("respondToWidget", { agentId: ctx.agentId, entryId: pending.entryId, value })
            .pipe(Effect.mapError(mapGatewayError("gateway/respondToWidget")));
        } else {
          yield* client
            .command("dismissWidget", { agentId: ctx.agentId, entryId: pending.entryId })
            .pipe(Effect.mapError(mapGatewayError("gateway/dismissWidget")));
        }
        yield* emit({
          type: "user-input.resolved",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId,
          turnId: ctx.activeTurn?.turnId,
          requestId: RuntimeRequestId.make(requestId),
          payload: { answers },
        });
      });

    const readThread: GrokBotAdapterShape["readThread"] = (threadId) =>
      Effect.map(requireSession(threadId), (ctx) => ({ threadId, turns: ctx.turns }));

    const rollbackThread: GrokBotAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        ctx.turns.splice(Math.max(0, ctx.turns.length - numTurns));
        return { threadId, turns: ctx.turns };
      });

    const stopSession: GrokBotAdapterShape["stopSession"] = (threadId) =>
      threadLocks.withLock(threadId, Effect.flatMap(requireSession(threadId), stopSessionInternal));

    const listSessions: GrokBotAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), (ctx) => ({ ...ctx.session })));

    const hasSession: GrokBotAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const ctx = sessions.get(threadId);
        return ctx !== undefined && !ctx.stopped;
      });

    const stopAll: GrokBotAdapterShape["stopAll"] = () =>
      Effect.forEach(Array.from(sessions.values()), stopSessionInternal, { discard: true });

    yield* Effect.addFinalizer(() =>
      stopAll().pipe(
        Effect.catch((cause) =>
          Effect.logError("Failed to emit Grok Bot session shutdown event.", { cause }),
        ),
        Effect.tap(() => PubSub.shutdown(runtimeEventPubSub)),
      ),
    );

    return {
      provider: PROVIDER,
      // A bot has exactly one model, and the box keeps the whole conversation.
      capabilities: { sessionModelSwitch: "unsupported", supportsConversationRollback: false },
      startSession,
      sendTurn,
      interruptTurn,
      respondToRequest,
      respondToUserInput,
      readThread,
      rollbackThread,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents: Stream.fromPubSub(runtimeEventPubSub),
    } satisfies GrokBotAdapterShape;
  });
}

function firstAnswer(answers: ProviderUserInputAnswers): string | undefined {
  for (const value of Object.values(answers)) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim())
      return value[0].trim();
  }
  return undefined;
}
