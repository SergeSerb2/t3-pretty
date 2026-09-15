import {
  IssueConnectionInput,
  IssuesError,
  type Issue,
  type IssueCommentInput,
  type IssueConnection,
  type IssueCreateInput,
  type IssueListInput,
  type IssueListResult,
  type IssueMetadata,
  type IssueProvider,
  type IssueRef,
  type IssueUpdateInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/unstable/http";
import { ServerSecretStore } from "../auth/ServerSecretStore.ts";
import { makeIssueApi } from "./IssueApi.ts";

export class IssuesService extends Context.Service<
  IssuesService,
  {
    connections: Effect.Effect<ReadonlyArray<IssueConnection>, IssuesError>;
    connect: (input: IssueConnectionInput) => Effect.Effect<IssueConnection, IssuesError>;
    disconnect: (provider: IssueProvider) => Effect.Effect<void, IssuesError>;
    metadata: (
      provider: IssueProvider,
      scopeId?: string,
    ) => Effect.Effect<IssueMetadata, IssuesError>;
    list: (input: IssueListInput) => Effect.Effect<IssueListResult, IssuesError>;
    detail: (input: IssueRef) => Effect.Effect<Issue, IssuesError>;
    create: (input: IssueCreateInput) => Effect.Effect<Issue, IssuesError>;
    update: (input: IssueUpdateInput) => Effect.Effect<Issue, IssuesError>;
    comment: (input: IssueCommentInput) => Effect.Effect<void, IssuesError>;
  }
>()("t3/issues/IssuesService") {}

const Stored = Schema.fromJsonString(
  Schema.Struct({ connection: IssueConnectionInput, account: Schema.String }),
);
const decodeStored = Schema.decodeUnknownEffect(Stored);
const encodeStored = Schema.encodeEffect(Stored);
const secretName = (provider: IssueProvider) => `native-issues-${provider}`;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const layer = Layer.effect(
  IssuesService,
  Effect.gen(function* () {
    const secrets = yield* ServerSecretStore;
    const api = makeIssueApi(yield* HttpClient.HttpClient);
    const mutex = yield* Semaphore.make(1);
    const read = Effect.fn("issues.readConnection")(function* (provider: IssueProvider) {
      const bytes = yield* secrets
        .get(secretName(provider))
        .pipe(
          Effect.mapError(
            () => new IssuesError({ message: "Could not read the issue connection." }),
          ),
        );
      if (Option.isNone(bytes)) return null;
      return yield* decodeStored(decoder.decode(bytes.value)).pipe(
        // A malformed credential should offer reconnect, not hide the other provider.
        Effect.orElseSucceed(() => null),
        Effect.map((stored) => (stored?.connection.provider === provider ? stored : null)),
      );
    });
    const requireConnection = Effect.fn("issues.requireConnection")(function* (
      provider: IssueProvider,
    ) {
      const stored = yield* read(provider);
      if (!stored || stored.connection.provider !== provider)
        return yield* new IssuesError({
          message: `Connect ${provider === "linear" ? "Linear" : "Sentry"} to manage issues.`,
        });
      return stored.connection;
    });
    return IssuesService.of({
      connections: Effect.forEach(["linear", "sentry"] as const, (provider) =>
        read(provider).pipe(
          Effect.map((stored) => (stored ? [{ provider, account: stored.account }] : [])),
        ),
      ).pipe(Effect.map((items) => items.flat())),
      connect: (connection) =>
        mutex.withPermits(1)(
          Effect.gen(function* () {
            const account = yield* api.verify(connection);
            const encoded = yield* encodeStored({ connection, account }).pipe(
              Effect.mapError(
                () => new IssuesError({ message: "Could not encode the issue connection." }),
              ),
            );
            yield* secrets
              .set(secretName(connection.provider), encoder.encode(encoded))
              .pipe(
                Effect.mapError(
                  () => new IssuesError({ message: "Could not save the issue connection." }),
                ),
              );
            return { provider: connection.provider, account };
          }),
        ),
      disconnect: (provider) =>
        mutex.withPermits(1)(
          secrets
            .remove(secretName(provider))
            .pipe(
              Effect.mapError(
                () => new IssuesError({ message: "Could not disconnect the issue service." }),
              ),
            ),
        ),
      metadata: (provider, scopeId) =>
        requireConnection(provider).pipe(
          Effect.flatMap((connection) => api.metadata(connection, scopeId)),
        ),
      list: (input) =>
        requireConnection(input.provider).pipe(
          Effect.flatMap((connection) => api.list(connection, input)),
        ),
      detail: (input) =>
        requireConnection(input.provider).pipe(
          Effect.flatMap((connection) => api.detail(connection, input.id)),
        ),
      create: (input) =>
        requireConnection("linear").pipe(
          Effect.flatMap((connection) => api.create(connection.token, input)),
        ),
      update: (input) =>
        requireConnection(input.provider).pipe(
          Effect.flatMap((connection) => api.update(connection, input)),
        ),
      comment: (input) =>
        requireConnection("linear").pipe(
          Effect.flatMap((connection) => api.comment(connection.token, input.id, input.body)),
        ),
    });
  }),
);
