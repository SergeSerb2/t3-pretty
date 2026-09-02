import * as Schema from "effect/Schema";

import { PortSchema, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const DESKTOP_BOOTSTRAP_PATH_MAX_LENGTH = 32 * 1024;
export const DESKTOP_BOOTSTRAP_HOST_MAX_LENGTH = 1_024;
export const DESKTOP_BOOTSTRAP_TOKEN_MAX_LENGTH = 64 * 1024;
export const DESKTOP_BOOTSTRAP_URL_MAX_LENGTH = 8_192;

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
  tailscaleServeEnabled: Schema.Boolean,
  tailscaleServePort: PortSchema,
  otlpTracesUrl: Schema.optional(DesktopBootstrapUrl),
  otlpMetricsUrl: Schema.optional(DesktopBootstrapUrl),
  desktopTelemetryFd: Schema.optionalKey(PositiveInt),
  desktopTelemetryControlFd: Schema.optionalKey(PositiveInt),
  resourceMonitorPath: Schema.optionalKey(
    TrimmedNonEmptyString.check(Schema.isMaxLength(DESKTOP_BOOTSTRAP_PATH_MAX_LENGTH)),
  ),
});

export type DesktopBackendBootstrap = typeof DesktopBackendBootstrap.Type;
