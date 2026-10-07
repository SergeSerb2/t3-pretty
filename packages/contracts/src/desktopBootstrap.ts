import * as Schema from "effect/Schema";

import { PortSchema, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const DESKTOP_BOOTSTRAP_PATH_MAX_LENGTH = 32 * 1024;
export const DESKTOP_BOOTSTRAP_HOST_MAX_LENGTH = 1_024;
export const DESKTOP_BOOTSTRAP_TOKEN_MAX_LENGTH = 64 * 1024;
export const DESKTOP_BOOTSTRAP_URL_MAX_LENGTH = 8_192;

// Keep these mirrored with desktopBearerTimeout.js, which is consumed directly
// by Node smokes without TypeScript type-stripping.
export const DESKTOP_LOCAL_BEARER_READY_TIMEOUT_MS = 90_000;
export const DESKTOP_LOCAL_BEARER_EXCHANGE_RETRY_TIMEOUT_MS = 8_000;
export const DESKTOP_LOCAL_BEARER_TOKEN_TIMEOUT_MS =
  DESKTOP_LOCAL_BEARER_READY_TIMEOUT_MS + DESKTOP_LOCAL_BEARER_EXCHANGE_RETRY_TIMEOUT_MS + 2_000;

const DesktopBootstrapPath = Schema.String.check(
  Schema.isMaxLength(DESKTOP_BOOTSTRAP_PATH_MAX_LENGTH),
);
const DesktopBootstrapUrl = Schema.String.check(
  Schema.isMaxLength(DESKTOP_BOOTSTRAP_URL_MAX_LENGTH),
);

export const DesktopBackendBootstrap = Schema.Struct({
  mode: Schema.Literal("desktop"),
  noBrowser: Schema.Boolean,
  port: PortSchema,
  // Omitted when the desktop launches the backend inside WSL, since the
  // Windows-side baseDir maps to /mnt/c/... and the Linux side should use its
  // own home directory instead.
  t3Home: Schema.optional(DesktopBootstrapPath),
  host: Schema.String.check(Schema.isMaxLength(DESKTOP_BOOTSTRAP_HOST_MAX_LENGTH)),
  desktopBootstrapToken: Schema.String.check(
    Schema.isMaxLength(DESKTOP_BOOTSTRAP_TOKEN_MAX_LENGTH),
  ),
  // Present when the desktop rotates the renderer's bootstrap token: the
  // backend derives the accepted tokens from this secret instead of trusting
  // `desktopBootstrapToken` for its whole run. See
  // `@t3tools/shared/desktopBootstrapToken`.
  desktopBootstrapSecret: Schema.optionalKey(Schema.String),
  tailscaleServeEnabled: Schema.Boolean,
  tailscaleServePort: PortSchema,
  otlpTracesUrl: Schema.optional(DesktopBootstrapUrl),
  otlpMetricsUrl: Schema.optional(DesktopBootstrapUrl),
  otlpLogsUrl: Schema.optional(DesktopBootstrapUrl),
  desktopTelemetryFd: Schema.optionalKey(PositiveInt),
  desktopTelemetryControlFd: Schema.optionalKey(PositiveInt),
  /** Desktop -> server: the desktop's browser tabs, as newline-delimited JSON. */
  desktopBrowserFd: Schema.optionalKey(PositiveInt),
  /** Server -> desktop: commands for those tabs. */
  desktopBrowserControlFd: Schema.optionalKey(PositiveInt),
  resourceMonitorPath: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(DESKTOP_BOOTSTRAP_PATH_MAX_LENGTH)),
  ),
});

export type DesktopBackendBootstrap = typeof DesktopBackendBootstrap.Type;

/** Written to `<t3Home>/runtime` just before the desktop app stops its
    backend to install an update. The updated app starts a new backend right
    away, so a backend that sees a fresh marker at shutdown keeps its managed
    tunnel. */
export const DESKTOP_UPDATE_RESTART_MARKER_FILE = "desktop-update-restart";
