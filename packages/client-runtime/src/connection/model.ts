import { EnvironmentId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const CONNECTION_ENVIRONMENT_ID_MAX_LENGTH = 512;
export const CONNECTION_ID_MAX_LENGTH = 512;
export const CONNECTION_LABEL_MAX_LENGTH = 2_048;
export const CONNECTION_URL_MAX_LENGTH = 8_192;
export const CONNECTION_SECRET_MAX_LENGTH = 64 * 1024;
export const CONNECTION_ERROR_DETAIL_MAX_LENGTH = 8_192;
export const CONNECTION_ERROR_TRACE_ID_MAX_LENGTH = 256;

export const ConnectionEnvironmentId = EnvironmentId.check(
  Schema.isMaxLength(CONNECTION_ENVIRONMENT_ID_MAX_LENGTH),
);
export const ConnectionId = Schema.String.check(Schema.isMaxLength(CONNECTION_ID_MAX_LENGTH));
export const ConnectionLabel = Schema.String.check(Schema.isMaxLength(CONNECTION_LABEL_MAX_LENGTH));
export const ConnectionUrl = Schema.String.check(Schema.isMaxLength(CONNECTION_URL_MAX_LENGTH));
export const ConnectionSecret = Schema.String.check(
  Schema.isMaxLength(CONNECTION_SECRET_MAX_LENGTH),
);

const ConnectionTargetBase = {
  environmentId: ConnectionEnvironmentId,
  label: ConnectionLabel,
};

export class PrimaryConnectionTarget extends Schema.TaggedClass<PrimaryConnectionTarget>()(
  "PrimaryConnectionTarget",
  {
    ...ConnectionTargetBase,
    httpBaseUrl: ConnectionUrl,
    wsBaseUrl: ConnectionUrl,
  },
) {}

export class BearerConnectionTarget extends Schema.TaggedClass<BearerConnectionTarget>()(
  "BearerConnectionTarget",
  {
    ...ConnectionTargetBase,
    connectionId: ConnectionId,
  },
) {}

export class RelayConnectionTarget extends Schema.TaggedClass<RelayConnectionTarget>()(
  "RelayConnectionTarget",
  {
    ...ConnectionTargetBase,
  },
) {}

export class SshConnectionTarget extends Schema.TaggedClass<SshConnectionTarget>()(
  "SshConnectionTarget",
  {
    ...ConnectionTargetBase,
    connectionId: ConnectionId,
  },
) {}

export const ConnectionTarget = Schema.Union([
  PrimaryConnectionTarget,
  BearerConnectionTarget,
  RelayConnectionTarget,
  SshConnectionTarget,
]);
export type ConnectionTarget = typeof ConnectionTarget.Type;

export const PersistedConnectionTarget = Schema.Union([
  BearerConnectionTarget,
  RelayConnectionTarget,
  SshConnectionTarget,
]);
export type PersistedConnectionTarget = typeof PersistedConnectionTarget.Type;

export type ConnectionTargetKind = ConnectionTarget["_tag"];

export type NetworkStatus = "unknown" | "offline" | "online";

export const ConnectionTransientReason = Schema.Literals([
  "network",
  "timeout",
  "transport",
  "endpoint-unavailable",
  "relay-unavailable",
  "remote-unavailable",
]);
export type ConnectionTransientReason = typeof ConnectionTransientReason.Type;

export const ConnectionBlockedReason = Schema.Literals([
  "authentication",
  "configuration",
  "permission",
  "unsupported",
]);
export type ConnectionBlockedReason = typeof ConnectionBlockedReason.Type;

const ConnectionErrorDetail = Schema.String.check(
  Schema.isMaxLength(CONNECTION_ERROR_DETAIL_MAX_LENGTH),
);
const ConnectionErrorTraceId = Schema.String.check(
  Schema.isMaxLength(CONNECTION_ERROR_TRACE_ID_MAX_LENGTH),
);

const boundedConnectionErrorFields = (props: {
  readonly detail: string;
  readonly traceId?: string;
}) => ({
  detail: props.detail.slice(0, CONNECTION_ERROR_DETAIL_MAX_LENGTH),
  ...(props.traceId === undefined
    ? {}
    : { traceId: props.traceId.slice(0, CONNECTION_ERROR_TRACE_ID_MAX_LENGTH) }),
});

export class ConnectionTransientError extends Schema.TaggedErrorClass<ConnectionTransientError>()(
  "ConnectionTransientError",
  {
    reason: ConnectionTransientReason,
    detail: ConnectionErrorDetail,
    traceId: Schema.optionalKey(ConnectionErrorTraceId),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: {
    readonly reason: ConnectionTransientReason;
    readonly detail: string;
    readonly traceId?: string;
  }) {
    super({ reason: props.reason, ...boundedConnectionErrorFields(props) });
  }

  override get message(): string {
    return this.detail;
  }
}

export class ConnectionBlockedError extends Schema.TaggedErrorClass<ConnectionBlockedError>()(
  "ConnectionBlockedError",
  {
    reason: ConnectionBlockedReason,
    detail: ConnectionErrorDetail,
    traceId: Schema.optionalKey(ConnectionErrorTraceId),
  },
) {
  // @effect-diagnostics-next-line overriddenSchemaConstructor:off
  constructor(props: {
    readonly reason: ConnectionBlockedReason;
    readonly detail: string;
    readonly traceId?: string;
  }) {
    super({ reason: props.reason, ...boundedConnectionErrorFields(props) });
  }

  override get message(): string {
    return this.detail;
  }
}

export type ConnectionAttemptError = ConnectionTransientError | ConnectionBlockedError;

export type PreparedHttpAuthorization =
  | {
      readonly _tag: "Bearer";
      readonly token: string;
    }
  | {
      readonly _tag: "Dpop";
      readonly accessToken: string;
    };

export interface PreparedConnection {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly httpBaseUrl: string;
  readonly socketUrl: string;
  readonly httpAuthorization: PreparedHttpAuthorization | null;
  readonly target: ConnectionTarget;
}

export type SupervisorConnectionPhase =
  | "available"
  | "offline"
  | "connecting"
  | "backoff"
  | "connected"
  | "blocked";

export type ConnectionAttemptStage = "preparing" | "opening" | "synchronizing";

export interface SupervisorConnectionState {
  readonly desired: boolean;
  readonly network: NetworkStatus;
  readonly phase: SupervisorConnectionPhase;
  readonly stage: ConnectionAttemptStage | null;
  readonly attempt: number;
  readonly generation: number;
  readonly lastFailure: ConnectionAttemptError | null;
  readonly retryAt: number | null;
}

export type ConnectionProjectionPhase = "disconnected" | "synchronizing" | "ready";

export function connectionProjectionPhase(
  state: SupervisorConnectionState,
): ConnectionProjectionPhase {
  switch (state.phase) {
    case "connecting":
      return "synchronizing";
    case "connected":
      return "ready";
    case "available":
    case "offline":
    case "backoff":
    case "blocked":
      return "disconnected";
  }
}

export const AVAILABLE_CONNECTION_STATE: SupervisorConnectionState = Object.freeze({
  desired: false,
  network: "unknown",
  phase: "available",
  stage: null,
  attempt: 0,
  generation: 0,
  lastFailure: null,
  retryAt: null,
});
