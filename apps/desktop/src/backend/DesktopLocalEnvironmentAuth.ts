import { bootstrapRemoteBearerSession } from "@t3tools/client-runtime/authorization";
import { PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";

import * as DesktopBackendPool from "./DesktopBackendPool.ts";

// The window opens (and the renderer asks for this token) before the child
// backend accepts HTTP. A single failed POST /oauth/token used to reject the
// IPC invoke with a nested Effect error; Electron often fails to clone that
// rejection, so the renderer promise never settles and #boot-shell stays up
// even after "backend ready". Wait for the primary latch, then retry the
// remaining listen race. Cause is a string so a late failure still serializes.
export const LOCAL_ENVIRONMENT_AUTH_READY_TIMEOUT = Duration.seconds(30);
export const LOCAL_ENVIRONMENT_AUTH_EXCHANGE_RETRY_TIMEOUT = Duration.seconds(8);
export const LOCAL_ENVIRONMENT_AUTH_EXCHANGE_RETRY_SPACING = Duration.millis(200);
export const LOCAL_ENVIRONMENT_AUTH_EXCHANGE_TIMEOUT_MS = 2_000;

export class DesktopLocalEnvironmentAuthBackendNotConfiguredError extends Schema.TaggedErrorClass<DesktopLocalEnvironmentAuthBackendNotConfiguredError>()(
  "DesktopLocalEnvironmentAuthBackendNotConfiguredError",
  {},
) {
  override get message(): string {
    return "Local backend is not configured.";
  }
}

export class DesktopLocalEnvironmentAuthSessionBootstrapError extends Schema.TaggedErrorClass<DesktopLocalEnvironmentAuthSessionBootstrapError>()(
  "DesktopLocalEnvironmentAuthSessionBootstrapError",
  { cause: Schema.String },
) {
  override get message(): string {
    return "Failed to create the local desktop bearer session.";
  }
}

export const DesktopLocalEnvironmentAuthError = Schema.Union([
  DesktopLocalEnvironmentAuthBackendNotConfiguredError,
  DesktopLocalEnvironmentAuthSessionBootstrapError,
]);
export type DesktopLocalEnvironmentAuthError = typeof DesktopLocalEnvironmentAuthError.Type;

export class DesktopLocalEnvironmentAuth extends Context.Service<
  DesktopLocalEnvironmentAuth,
  {
    readonly getBearerToken: Effect.Effect<string, DesktopLocalEnvironmentAuthError>;
  }
>()("@t3tools/desktop/backend/DesktopLocalEnvironmentAuth") {}

const isRetryableLocalBearerBootstrapError = (error: { readonly _tag: string }): boolean => {
  switch (error._tag) {
    case "RemoteEnvironmentAuthFetchError":
    case "RemoteEnvironmentAuthTimeoutError":
      return true;
    case "RemoteEnvironmentAuthUndeclaredStatusError":
      return (
        "status" in error &&
        (error.status === 502 || error.status === 503 || error.status === 504)
      );
    default:
      return false;
  }
};

const describeLocalBearerBootstrapCause = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  if (typeof cause === "object" && cause !== null && "message" in cause) {
    const message = cause.message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return "Failed to create the local desktop bearer session.";
};

export const make = Effect.gen(function* () {
  const pool = yield* DesktopBackendPool.DesktopBackendPool;
  const httpClient = yield* HttpClient.HttpClient;
  const tokenRef = yield* Ref.make(Option.none<string>());
  const mutex = yield* Semaphore.make(1);

  const getBearerToken = mutex
    .withPermits(1)(
      Effect.gen(function* () {
        const cached = yield* Ref.get(tokenRef);
        if (Option.isSome(cached)) {
          return cached.value;
        }

        const instances = yield* pool.list;
        const primary = instances.find((instance) => instance.id === PRIMARY_LOCAL_ENVIRONMENT_ID);
        const configOption = primary === undefined ? Option.none() : yield* primary.currentConfig;
        if (Option.isNone(configOption) || primary === undefined) {
          return yield* new DesktopLocalEnvironmentAuthBackendNotConfiguredError();
        }
        const config = configOption.value;
        const credential = config.bootstrap.desktopBootstrapToken;
        if (!credential) {
          return yield* new DesktopLocalEnvironmentAuthBackendNotConfiguredError();
        }

        yield* primary.waitForReady(LOCAL_ENVIRONMENT_AUTH_READY_TIMEOUT).pipe(
          Effect.catchCause((cause) =>
            Effect.fail(
              new DesktopLocalEnvironmentAuthSessionBootstrapError({
                cause: describeLocalBearerBootstrapCause(Cause.squash(cause)),
              }),
            ),
          ),
        );

        const session = yield* bootstrapRemoteBearerSession({
          httpBaseUrl: config.httpBaseUrl.href,
          credential,
          clientMetadata: {
            label: "T3 Pretty Desktop",
            deviceType: "desktop",
          },
          timeoutMs: LOCAL_ENVIRONMENT_AUTH_EXCHANGE_TIMEOUT_MS,
        }).pipe(
          Effect.provideService(HttpClient.HttpClient, httpClient),
          Effect.retry({
            while: isRetryableLocalBearerBootstrapError,
            schedule: Schedule.spaced(LOCAL_ENVIRONMENT_AUTH_EXCHANGE_RETRY_SPACING),
          }),
          Effect.timeoutOption(LOCAL_ENVIRONMENT_AUTH_EXCHANGE_RETRY_TIMEOUT),
          Effect.mapError((cause) =>
            new DesktopLocalEnvironmentAuthSessionBootstrapError({
              cause: describeLocalBearerBootstrapCause(cause),
            }),
          ),
          Effect.flatMap((option) =>
            Option.match(option, {
              onNone: () =>
                Effect.fail(
                  new DesktopLocalEnvironmentAuthSessionBootstrapError({
                    cause: "Timed out waiting for the local backend bearer session.",
                  }),
                ),
              onSome: Effect.succeed,
            }),
          ),
        );
        yield* Ref.set(tokenRef, Option.some(session.access_token));
        return session.access_token;
      }),
    )
    .pipe(Effect.withSpan("desktop.localEnvironmentAuth.getBearerToken"));

  return DesktopLocalEnvironmentAuth.of({ getBearerToken });
});

export const layer = Layer.effect(DesktopLocalEnvironmentAuth, make);
