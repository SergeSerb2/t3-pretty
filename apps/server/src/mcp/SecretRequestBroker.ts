import {
  EventId,
  type ProviderInstanceEnvironmentVariable,
  type OrchestrationV2RuntimeRequest,
  type OrchestrationV2TurnItem,
  TurnItemId,
  RuntimeRequestId,
  SecretRequestError,
  type ThreadId,
  type ThreadSecretRequestRespondInput,
  type ThreadSecretRequestRespondResult,
  type OrchestrationV2UserInputQuestion,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as DateTime from "effect/DateTime";
import * as ServerSettings from "../serverSettings.ts";
import type * as McpInvocationContext from "./McpInvocationContext.ts";

export interface SecretRequestInput {
  readonly scope: McpInvocationContext.McpThreadInvocationScope;
  /** Environment variable the value will be stored under, e.g. OPENAI_API_KEY. */
  readonly name: string;
  /** Why the agent needs it, shown to the user verbatim. */
  readonly purpose: string;
  /** Service the key belongs to, e.g. "OpenAI"; used for the prompt title. */
  readonly service?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

export type SecretRequestOutcome =
  | {
      readonly status: "provided";
      readonly name: string;
      /** File holding the raw value, mode 0600, for shells started before the variable existed. */
      readonly secretPath: string;
    }
  | { readonly status: "declined"; readonly name: string }
  | { readonly status: "timed_out"; readonly name: string }
  | { readonly status: "cancelled"; readonly name: string };

export class SecretRequestPendingError extends Data.TaggedError("SecretRequestPendingError")<{
  readonly threadId: ThreadId;
}> {
  override get message(): string {
    return "Another API key request is already waiting on the user for this thread.";
  }
}

export class SecretRequestBroker extends Context.Service<
  SecretRequestBroker,
  {
    /** Open a masked prompt in the thread and wait for the user's answer. */
    readonly request: (
      input: SecretRequestInput,
    ) => Effect.Effect<SecretRequestOutcome, SecretRequestPendingError>;
    /** Client reply: store the value (or record a decline) and release the waiting tool call. */
    readonly respond: (
      input: ThreadSecretRequestRespondInput,
    ) => Effect.Effect<ThreadSecretRequestRespondResult, SecretRequestError>;
  }
>()("t3/mcp/SecretRequestBroker") {}

/** Codex gives MCP tools 60s by default; adapters raise it so this wait can be generous. */
export const SECRET_REQUEST_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

interface PendingSecretRequest {
  readonly threadId: ThreadId;
  readonly name: string;
  readonly deferred: Deferred.Deferred<SecretRequestOutcome>;
  /**
   * Set while a reply is being persisted. The waiter then defers its own
   * timeout or cancel until the write finishes, so a settled prompt can never
   * have a value stored behind it; if the write fails, the waiter settles
   * with the outcome it was holding.
   */
  claimed: boolean;
  releaseWith: SecretRequestOutcome | null;
}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const events = yield* EventSink.EventSinkV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;

  const pending = new Map<string, PendingSecretRequest>();

  const secretPathFor = (name: string) =>
    path.join(serverConfig.secretsDir, `${ServerSettings.globalEnvironmentSecretName(name)}.bin`);

  const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);

  const questionFor = (input: SecretRequestInput): OrchestrationV2UserInputQuestion => ({
    id: input.name,
    header: input.service ? `${input.service} API key` : "API key needed",
    question: input.purpose,
    options: [],
    allowCustomAnswer: true,
    multiSelect: false,
    secret: { name: input.name },
  });

  /**
   * Store the value as a sensitive global environment variable. Existing
   * sensitive entries are sent back redacted so their secrets are kept as is;
   * a non-sensitive entry with the same name is replaced.
   */
  const persist = (name: string, value: string) =>
    Effect.gen(function* () {
      const settings = yield* serverSettings.getSettings;
      const kept = settings.globalEnvironment
        .filter((variable) => variable.name !== name)
        .map((variable): ProviderInstanceEnvironmentVariable =>
          variable.sensitive ? { ...variable, value: "", valueRedacted: true } : variable,
        );
      yield* serverSettings.updateSettings({
        globalEnvironment: [...kept, { name, value, sensitive: true }],
      });
    }).pipe(
      Effect.mapError(
        (cause) =>
          new SecretRequestError({
            reason: "persist-failed",
            cause,
          }),
      ),
    );

  const requestUnchecked: SecretRequestBroker["Service"]["request"] = Effect.fn(
    "SecretRequestBroker.request",
  )(function* (input) {
    const threadId = input.scope.thread.threadId;
    for (const entry of pending.values()) {
      if (entry.threadId === threadId) {
        return yield* new SecretRequestPendingError({ threadId });
      }
    }
    const projection = yield* threads
      .getThreadRecords(threadId, ["runs", "runtimeRequests"])
      .pipe(Effect.orDie);
    const run = projection.runs.findLast((candidate) => candidate.status === "running");
    if (run?.rootNodeId == null) return { status: "cancelled", name: input.name } as const;
    if (projection.runtimeRequests.some((request) => request.status === "pending")) {
      return yield* new SecretRequestPendingError({ threadId });
    }
    const requestId = RuntimeRequestId.make(`secret-request:${yield* uuid}`);
    const deferred = yield* Deferred.make<SecretRequestOutcome>();
    const entry: PendingSecretRequest = {
      threadId,
      name: input.name,
      deferred,
      claimed: false,
      releaseWith: null,
    };
    pending.set(requestId, entry);
    const at = yield* DateTime.now;
    const runtimeRequest: OrchestrationV2RuntimeRequest = {
      id: requestId,
      nodeId: run.rootNodeId,
      providerTurnId: null,
      nativeRequestRef: null,
      kind: "user_input",
      status: "pending",
      responseCapability: {
        type: "not_resumable",
        reason: "Respond through the secret request broker.",
      },
      createdAt: at,
      resolvedAt: null,
    };
    const turnItem: Extract<OrchestrationV2TurnItem, { type: "user_input_request" }> = {
      id: TurnItemId.make(`secret-prompt:${requestId}`),
      threadId,
      runId: run.id,
      nodeId: run.rootNodeId,
      providerThreadId: run.providerThreadId,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: yield* projections.getNextTurnItemOrdinal(threadId).pipe(Effect.orDie),
      type: "user_input_request",
      requestId,
      questions: [questionFor(input)],
      status: "pending",
      title: "API key needed",
      startedAt: at,
      completedAt: null,
      updatedAt: at,
    };
    const publish = (request: OrchestrationV2RuntimeRequest, item: typeof turnItem) =>
      Effect.gen(function* () {
        const occurredAt = yield* DateTime.now;
        yield* events
          .write({
            events: [
              {
                id: EventId.make(`secret-runtime:${yield* uuid}`),
                type: "runtime-request.updated",
                threadId,
                runId: run.id,
                nodeId: runtimeRequest.nodeId,
                occurredAt,
                payload: request,
              },
              {
                id: EventId.make(`secret-item:${yield* uuid}`),
                type: "turn-item.updated",
                threadId,
                runId: run.id,
                nodeId: runtimeRequest.nodeId,
                occurredAt,
                payload: item,
              },
            ],
          })
          .pipe(Effect.orDie);
      });

    // A claimed entry is mid-write: hand the outcome to the reply path instead.
    const settle = (outcome: SecretRequestOutcome) =>
      Effect.suspend(() => {
        if (entry.claimed) {
          entry.releaseWith = outcome;
          return Effect.void;
        }
        return Deferred.succeed(deferred, outcome).pipe(Effect.asVoid);
      });
    const cancelled: SecretRequestOutcome = { status: "cancelled", name: input.name };
    const timedOut: SecretRequestOutcome = { status: "timed_out", name: input.name };

    const finish = Effect.gen(function* () {
      pending.delete(requestId);
      const resolvedAt = yield* DateTime.now;
      // The stored transcript contains prompt metadata and status only. Secret
      // responses never travel through runtime-request.respond or answers.
      yield* publish(
        { ...runtimeRequest, status: "resolved", resolvedAt },
        { ...turnItem, status: "completed", completedAt: resolvedAt, updatedAt: resolvedAt },
      );
    });

    return yield* Effect.scoped(
      Effect.gen(function* () {
        // Subscribe before publishing so a turn that ends immediately cannot
        // slip past; starting immediately attaches the subscription right away.
        yield* Effect.forkScoped(
          Stream.runForEach(threads.streamDomainEvents, (event) =>
            event.threadId === threadId &&
            ((event.type === "run.updated" &&
              event.payload.id === run.id &&
              !["running", "starting", "queued"].includes(event.payload.status)) ||
              event.type === "thread.deleted" ||
              event.type === "thread.archived")
              ? settle(cancelled)
              : Effect.void,
          ),
          { startImmediately: true },
        );
        yield* publish(runtimeRequest, turnItem);
        const outcome = yield* Deferred.await(deferred).pipe(
          Effect.timeoutOption(input.timeoutMs ?? SECRET_REQUEST_DEFAULT_TIMEOUT_MS),
        );
        if (Option.isSome(outcome)) return outcome.value;
        // Settle before returning so a late reply is rejected rather than stored.
        yield* settle(timedOut);
        return yield* Deferred.await(deferred);
      }),
    ).pipe(Effect.ensuring(finish));
  });

  const reservedThreads = new Set<ThreadId>();
  const request: SecretRequestBroker["Service"]["request"] = (input) =>
    Effect.suspend(() => {
      const threadId = input.scope.thread.threadId;
      if (reservedThreads.has(threadId))
        return Effect.fail(new SecretRequestPendingError({ threadId }));
      reservedThreads.add(threadId);
      return requestUnchecked(input).pipe(
        Effect.ensuring(Effect.sync(() => reservedThreads.delete(threadId))),
      );
    });

  const respond: SecretRequestBroker["Service"]["respond"] = Effect.fn(
    "SecretRequestBroker.respond",
  )(function* (input) {
    const entry = pending.get(input.requestId);
    // A settled deferred means the turn ended or the wait timed out while the
    // user was typing; the tool result is already gone, so do not store the
    // value. A claimed entry is a double submit still being written.
    if (
      !entry ||
      entry.threadId !== input.threadId ||
      entry.claimed ||
      (yield* Deferred.isDone(entry.deferred))
    ) {
      return yield* new SecretRequestError({
        reason: "unknown-request",
      });
    }
    // Claim the request before persisting so a double submit cannot store
    // twice and the waiter holds its timeout or cancel until the write is done.
    // The entry stays in `pending` (the waiter removes it) so the thread keeps
    // its one-open-prompt lock for the whole write.
    entry.claimed = true;
    if (input.response.kind === "provided") {
      yield* persist(entry.name, input.response.value).pipe(
        Effect.tapError(() =>
          Effect.suspend(() => {
            entry.claimed = false;
            if (entry.releaseWith) {
              return Deferred.succeed(entry.deferred, entry.releaseWith).pipe(Effect.asVoid);
            }
            // The entry is still pending, so the user can retry the write.
            return Effect.void;
          }),
        ),
      );
      yield* Deferred.succeed(entry.deferred, {
        status: "provided",
        name: entry.name,
        secretPath: secretPathFor(entry.name),
      });
    } else {
      yield* Deferred.succeed(entry.deferred, { status: "declined", name: entry.name });
    }
    return { name: entry.name };
  });

  return SecretRequestBroker.of({ request, respond });
}).pipe(Effect.withSpan("SecretRequestBroker.make"));

export const layer = Layer.effect(SecretRequestBroker, make);
