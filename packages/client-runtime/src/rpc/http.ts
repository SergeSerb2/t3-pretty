import {
  EnvironmentHttpApi,
  EnvironmentHttpCommonError,
  type EnvironmentAuthInvalidError,
  type EnvironmentInternalError,
  type EnvironmentOperationForbiddenError,
  type EnvironmentRequestInvalidError,
  type EnvironmentResourceNotFoundError,
  type EnvironmentScopeRequiredError,
} from "@t3tools/contracts";
import { httpHeaderRedactionLayer } from "@t3tools/shared/httpObservability";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientError } from "effect/unstable/http";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";

const isEnvironmentHttpCommonError = Schema.is(EnvironmentHttpCommonError);

const REMOTE_ERROR_DETAIL_MAX_LENGTH = 4_096;
const REMOTE_ERROR_NAME_MAX_LENGTH = 128;

function readRemoteErrorText(
  value: object,
  key: PropertyKey,
  maxLength: number,
): string | undefined {
  try {
    const text = Reflect.get(value, key);
    return typeof text === "string" ? text.slice(0, maxLength) : undefined;
  } catch {
    return undefined;
  }
}

function describeRemoteRequestCause(cause: unknown): string {
  if ((typeof cause === "object" && cause !== null) || typeof cause === "function") {
    const message = readRemoteErrorText(cause, "message", REMOTE_ERROR_DETAIL_MAX_LENGTH);
    const name = readRemoteErrorText(cause, "name", REMOTE_ERROR_NAME_MAX_LENGTH);
    if (message !== undefined) {
      return (name === undefined ? message : `${name}: ${message}`).slice(
        0,
        REMOTE_ERROR_DETAIL_MAX_LENGTH,
      );
    }
    return name ?? typeof cause;
  }
  if (typeof cause === "string") {
    return cause.slice(0, REMOTE_ERROR_DETAIL_MAX_LENGTH);
  }
  if (typeof cause === "symbol") {
    return cause.description?.slice(0, REMOTE_ERROR_DETAIL_MAX_LENGTH) ?? "symbol";
  }
  if (cause === null) {
    return "null";
  }
  switch (typeof cause) {
    case "bigint":
    case "boolean":
    case "number":
    case "undefined":
      return String(cause);
  }
  return "unknown";
}

export class RemoteEnvironmentAuthFetchError extends Data.TaggedError(
  "RemoteEnvironmentAuthFetchError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class RemoteEnvironmentAuthInvalidJsonError extends Data.TaggedError(
  "RemoteEnvironmentAuthInvalidJsonError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

export class RemoteEnvironmentAuthUndeclaredStatusError extends Data.TaggedError(
  "RemoteEnvironmentAuthUndeclaredStatusError",
)<{
  readonly message: string;
  readonly status: number;
  readonly requestUrl: string;
}> {
  constructor(requestUrl: string, status: number) {
    super({
      message: `Remote environment endpoint ${requestUrl} returned undeclared status ${status}.`,
      requestUrl,
      status,
    });
  }
}

export class RemoteEnvironmentAuthTimeoutError extends Data.TaggedError(
  "RemoteEnvironmentAuthTimeoutError",
)<{
  readonly message: string;
  readonly requestUrl: string;
  readonly timeoutMs: number;
}> {
  constructor(requestUrl: string, timeoutMs: number) {
    super({
      message: `Remote environment endpoint ${requestUrl} timed out after ${timeoutMs}ms.`,
      requestUrl,
      timeoutMs,
    });
  }
}

export type RemoteEnvironmentRequestError =
  | EnvironmentRequestInvalidError
  | EnvironmentAuthInvalidError
  | EnvironmentScopeRequiredError
  | EnvironmentOperationForbiddenError
  | EnvironmentResourceNotFoundError
  | EnvironmentInternalError
  | RemoteEnvironmentAuthFetchError
  | RemoteEnvironmentAuthInvalidJsonError
  | RemoteEnvironmentAuthUndeclaredStatusError
  | RemoteEnvironmentAuthTimeoutError;

export const remoteHttpClientLayer = (
  fetchFn: typeof globalThis.fetch,
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.merge(
    FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchFn))),
    httpHeaderRedactionLayer,
  );

const remoteApiBaseUrl = (httpBaseUrl: string): string => {
  const url = new URL(httpBaseUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
};

export const makeEnvironmentHttpApiClient = (httpBaseUrl: string) =>
  HttpApiClient.make(EnvironmentHttpApi, {
    baseUrl: remoteApiBaseUrl(httpBaseUrl),
  });

/** Contract-derived request URLs for authentication proofs, tracing, and structured errors. */
export const makeEnvironmentHttpApiUrlBuilder = (httpBaseUrl: string) =>
  HttpApiClient.urlBuilder(EnvironmentHttpApi, {
    baseUrl: remoteApiBaseUrl(httpBaseUrl),
  });

const remoteRequestError = (requestUrl: string, cause: unknown): RemoteEnvironmentRequestError => {
  if (cause instanceof RemoteEnvironmentAuthTimeoutError) {
    return cause;
  }
  if (isEnvironmentHttpCommonError(cause)) {
    return cause;
  }
  if (Schema.isSchemaError(cause)) {
    return new RemoteEnvironmentAuthInvalidJsonError({
      message: `Remote environment endpoint returned an invalid response from ${requestUrl}.`,
      cause,
    });
  }
  if (HttpClientError.isHttpClientError(cause) && cause.response !== undefined) {
    const response = cause.response;
    if (response.status < 200 || response.status >= 300) {
      return new RemoteEnvironmentAuthUndeclaredStatusError(requestUrl, response.status);
    }
    return new RemoteEnvironmentAuthInvalidJsonError({
      message: `Remote environment endpoint returned an invalid response from ${requestUrl}.`,
      cause,
    });
  }
  return new RemoteEnvironmentAuthFetchError({
    message: `Failed to fetch remote environment endpoint ${requestUrl} (${describeRemoteRequestCause(cause)}).`,
    cause,
  });
};

export const executeEnvironmentHttpRequest = <A, E, R>(
  requestUrl: string,
  timeoutMs: number,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, RemoteEnvironmentRequestError, R> =>
  request.pipe(
    Effect.timeoutOption(Duration.millis(timeoutMs)),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new RemoteEnvironmentAuthTimeoutError(requestUrl, timeoutMs)),
        onSome: Effect.succeed,
      }),
    ),
    Effect.mapError((cause) => remoteRequestError(requestUrl, cause)),
  );

export const executeEnvironmentHttpRequestWithAdditionalError = <A, E, R, AdditionalError>(
  requestUrl: string,
  timeoutMs: number,
  request: Effect.Effect<A, E, R>,
  isAdditionalError: (cause: unknown) => cause is AdditionalError,
): Effect.Effect<A, RemoteEnvironmentRequestError | AdditionalError, R> =>
  request.pipe(
    Effect.timeoutOption(Duration.millis(timeoutMs)),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new RemoteEnvironmentAuthTimeoutError(requestUrl, timeoutMs)),
        onSome: Effect.succeed,
      }),
    ),
    Effect.mapError((cause): RemoteEnvironmentRequestError | AdditionalError => {
      const additionalCause: unknown = cause;
      return isAdditionalError(additionalCause)
        ? additionalCause
        : remoteRequestError(requestUrl, cause);
    }),
  );
