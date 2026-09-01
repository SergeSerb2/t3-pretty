import * as Schema from "effect/Schema";

import {
  AuthSessionId,
  EnvironmentId,
  NonNegativeInt,
  RpcClientId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { PROJECT_PATH_MAX_LENGTH } from "./project.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export const CLIENT_ACTIVITY_CLIENT_ID_MAX_LENGTH = 128;
export const CLIENT_ACTIVITY_NETWORK_TYPE_MAX_LENGTH = 128;
export const CLIENT_ACTIVITY_MAX_SCOPES = 32;
export const CLIENT_ACTIVITY_MAX_SCOPE_KEY_CHARS = 64 * 1024;
export const CLIENT_ACTIVITY_MAX_LEASES_PER_RPC_CLIENT = 16;
export const CLIENT_ACTIVITY_MAX_LEASES = 256;
export const CLIENT_ACTIVITY_MAX_ACTIVE_SCOPE_KEYS =
  CLIENT_ACTIVITY_MAX_LEASES * CLIENT_ACTIVITY_MAX_SCOPES;
export const CLIENT_ACTIVITY_MAX_ACTIVE_SCOPE_KEY_LENGTH = PROJECT_PATH_MAX_LENGTH + 32;
export const CLIENT_ACTIVITY_MAX_ACTIVE_SCOPE_KEY_CHARS =
  CLIENT_ACTIVITY_MAX_LEASES *
  (CLIENT_ACTIVITY_MAX_SCOPE_KEY_CHARS + CLIENT_ACTIVITY_MAX_SCOPES * 32);
export const CLIENT_ACTIVITY_DEFAULT_LEASE_TTL_MS = 45_000;
export const CLIENT_ACTIVITY_MIN_LEASE_TTL_MS = 1_000;
export const CLIENT_ACTIVITY_MAX_LEASE_TTL_MS = 120_000;

const BackgroundScopeCwd = TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_PATH_MAX_LENGTH));
const ClientActivityNetworkType = Schema.String.check(
  Schema.isMaxLength(CLIENT_ACTIVITY_NETWORK_TYPE_MAX_LENGTH),
);

export const BackgroundBooleanState = Schema.Literals(["true", "false", "unknown"]);
export type BackgroundBooleanState = typeof BackgroundBooleanState.Type;

export const HostPowerThermalState = Schema.Literals([
  "unknown",
  "nominal",
  "fair",
  "serious",
  "critical",
]);
export type HostPowerThermalState = typeof HostPowerThermalState.Type;

export const HostPowerSource = Schema.Literals([
  "unknown",
  "node-macos-shell",
  "node-macos-native",
  "node-linux",
  "node-windows",
  "electron-main",
]);
export type HostPowerSource = typeof HostPowerSource.Type;

export const HostPowerSnapshot = Schema.Struct({
  source: HostPowerSource,
  idle: BackgroundBooleanState,
  idleSeconds: Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  locked: BackgroundBooleanState,
  suspended: Schema.Boolean,
  onBattery: BackgroundBooleanState,
  lowPowerMode: BackgroundBooleanState,
  thermalState: HostPowerThermalState,
  stale: Schema.Boolean,
  updatedAt: Schema.DateTimeUtc,
});
export type HostPowerSnapshot = typeof HostPowerSnapshot.Type;

export const BackgroundScope = Schema.Union([
  Schema.Struct({ type: Schema.Literal("server-config") }),
  Schema.Struct({
    type: Schema.Literal("provider-status"),
    instanceId: Schema.optionalKey(ProviderInstanceId),
  }),
  Schema.Struct({ type: Schema.Literal("vcs-status"), cwd: BackgroundScopeCwd }),
  Schema.Struct({ type: Schema.Literal("git-refs"), cwd: BackgroundScopeCwd }),
  Schema.Struct({ type: Schema.Literal("diagnostics") }),
  Schema.Struct({ type: Schema.Literal("thread"), threadId: ThreadId }),
]);
export type BackgroundScope = typeof BackgroundScope.Type;

export const ClientKind = Schema.Literals(["web", "desktop-renderer", "mobile", "unknown"]);
export type ClientKind = typeof ClientKind.Type;

export const ClientActivityClientId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CLIENT_ACTIVITY_CLIENT_ID_MAX_LENGTH),
);
export type ClientActivityClientId = typeof ClientActivityClientId.Type;

const ClientActivityScopes = Schema.Array(BackgroundScope).check(
  Schema.isMaxLength(CLIENT_ACTIVITY_MAX_SCOPES),
  Schema.makeFilter((scopes) => {
    let totalKeyCharacters = 0;
    for (const scope of scopes) {
      totalKeyCharacters +=
        scope.type === "vcs-status" || scope.type === "git-refs"
          ? scope.cwd.length
          : scope.type === "provider-status"
            ? (scope.instanceId?.length ?? 0)
            : scope.type === "thread"
              ? scope.threadId.length
              : scope.type.length;
      if (totalKeyCharacters > CLIENT_ACTIVITY_MAX_SCOPE_KEY_CHARS) {
        return `background scope keys must total at most ${CLIENT_ACTIVITY_MAX_SCOPE_KEY_CHARS} characters`;
      }
    }
    return true;
  }),
);

const ClientActivityLeaseTtlMs = Schema.Int.check(
  Schema.isBetween({
    minimum: CLIENT_ACTIVITY_MIN_LEASE_TTL_MS,
    maximum: CLIENT_ACTIVITY_MAX_LEASE_TTL_MS,
  }),
);

export const ClientActivityReportInput = Schema.Struct({
  environmentId: Schema.optionalKey(EnvironmentId),
  clientId: ClientActivityClientId,
  clientKind: ClientKind,
  visible: Schema.Boolean,
  focused: Schema.Boolean,
  recentlyInteracted: Schema.Boolean,
  appState: Schema.optionalKey(Schema.Literals(["active", "inactive", "background", "unknown"])),
  lowPowerMode: Schema.optionalKey(BackgroundBooleanState),
  batteryState: Schema.optionalKey(Schema.Literals(["unknown", "unplugged", "charging", "full"])),
  networkType: Schema.optionalKey(ClientActivityNetworkType),
  scopes: ClientActivityScopes,
  ttlMs: Schema.optionalKey(ClientActivityLeaseTtlMs),
  observedAt: Schema.DateTimeUtc,
});
export type ClientActivityReportInput = typeof ClientActivityReportInput.Type;

export const ClientActivityLease = Schema.Struct({
  sessionId: AuthSessionId,
  rpcClientId: RpcClientId,
  clientId: ClientActivityClientId,
  clientKind: ClientKind,
  visible: Schema.Boolean,
  focused: Schema.Boolean,
  recentlyInteracted: Schema.Boolean,
  appState: Schema.optionalKey(Schema.Literals(["active", "inactive", "background", "unknown"])),
  lowPowerMode: Schema.optionalKey(BackgroundBooleanState),
  batteryState: Schema.optionalKey(Schema.Literals(["unknown", "unplugged", "charging", "full"])),
  networkType: Schema.optionalKey(ClientActivityNetworkType),
  scopes: ClientActivityScopes,
  updatedAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
});
export type ClientActivityLease = typeof ClientActivityLease.Type;

export const BackgroundPolicySnapshot = Schema.Struct({
  hostPower: HostPowerSnapshot,
  leases: Schema.Array(ClientActivityLease).check(Schema.isMaxLength(CLIENT_ACTIVITY_MAX_LEASES)),
  activeForegroundLeaseCount: NonNegativeInt.check(
    Schema.isLessThanOrEqualTo(CLIENT_ACTIVITY_MAX_LEASES),
  ),
  activeScopeKeys: Schema.Array(
    Schema.String.check(Schema.isMaxLength(CLIENT_ACTIVITY_MAX_ACTIVE_SCOPE_KEY_LENGTH)),
  ).check(
    Schema.isMaxLength(CLIENT_ACTIVITY_MAX_ACTIVE_SCOPE_KEYS),
    Schema.makeFilter((keys) => {
      let totalCharacters = 0;
      for (const key of keys) {
        totalCharacters += key.length;
        if (totalCharacters > CLIENT_ACTIVITY_MAX_ACTIVE_SCOPE_KEY_CHARS) {
          return `active scope keys must total at most ${CLIENT_ACTIVITY_MAX_ACTIVE_SCOPE_KEY_CHARS} characters`;
        }
      }
      return true;
    }),
  ),
  shouldRunOpportunisticWork: Schema.Boolean,
  updatedAt: Schema.DateTimeUtc,
});
export type BackgroundPolicySnapshot = typeof BackgroundPolicySnapshot.Type;
