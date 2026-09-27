import {
  EventId,
  type ProviderInstanceEnvironmentVariable,
  type ProviderRuntimeEvent,
  RuntimeRequestId,
  SecretRequestError,
  type ThreadId,
  type ThreadSecretRequestRespondInput,
  type ThreadSecretRequestRespondResult,
  type UserInputQuestion,
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
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderService from "../provider/Services/ProviderService.ts";
import * as ServerSettings from "../serverSettings.ts";
import type * as McpInvocationContext from "./McpInvocationContext.ts";

export interface SecretRequestInput {
  readonly scope: McpInvocationContext.McpInvocationScope;
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

/** Runtime events after which the agent can no longer receive the tool result. */
const isTerminalForThread = (event: ProviderRuntimeEvent, threadId: ThreadId): boolean =>
  event.threadId === threadId &&
  (event.type === "turn.completed" ||
    event.type === "turn.aborted" ||
    event.type === "session.exited");

const make = Effect.gen(function* () {
  const providerService = yield* ProviderService.ProviderService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;

  const pending = new Map<string, PendingSecretRequest>();

  const secretPathFor = (name: string) =>
    path.join(serverConfig.secretsDir, `${ServerSettings.globalEnvironmentSecretName(name)}.bin`);

  const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);
  const now = () => new Date().toISOString();

  const questionFor = (input: SecretRequestInput): UserInputQuestion => ({
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
            message: `Could not store ${name}: ${cause.message}`,
          }),
      ),
    );

  const request: SecretRequestBroker["Service"]["request"] = Effect.fn(
    "SecretRequestBroker.request",
  )(function* (input) {
    const threadId = input.scope.threadId;
    for (const entry of pending.values()) {
      if (entry.threadId === threadId) {
        return yield* new SecretRequestPendingError({ threadId });
      }
    }
    const instance = yield* providerService.getInstanceInfo(input.scope.providerInstanceId).pipe(
      Effect.map((info) => info.driverKind),
      Effect.orDie,
    );
    const thread = yield* snapshots.getThreadShellById(threadId).pipe(
      Effect.map(Option.getOrUndefined),
      Effect.orElseSucceed(() => undefined),
    );
    const turnId = thread?.latestTurn?.state === "running" ? thread.latestTurn.turnId : undefined;
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
    const base = {
      provider: instance,
      providerInstanceId: input.scope.providerInstanceId,
      threadId,
      requestId,
      ...(turnId ? { turnId } : {}),
    };

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
      yield* providerService.publishRuntimeEvent({
        ...base,
        type: "user-input.resolved",
        eventId: EventId.make(`secret-request-resolved:${yield* uuid}`),
        createdAt: now(),
        payload: { answers: {} },
      });
    });

    return yield* Effect.scoped(
      Effect.gen(function* () {
        // Subscribe before publishing so a turn that ends immediately cannot
        // slip past; starting immediately attaches the subscription right away.
        yield* Effect.forkScoped(
          Stream.runForEach(providerService.streamEvents, (event) =>
            isTerminalForThread(event, threadId) ? settle(cancelled) : Effect.void,
          ),
          { startImmediately: true },
        );
        yield* providerService.publishRuntimeEvent({
          ...base,
          type: "user-input.requested",
          eventId: EventId.make(`secret-request:${yield* uuid}`),
          createdAt: now(),
          payload: { questions: [questionFor(input)] },
        });
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
        message: "This API key request is no longer waiting for an answer.",
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
