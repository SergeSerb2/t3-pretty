/**
 * Model selection + runtime mode: the two per-thread knobs that every
 * agent-driving record (threads, project defaults, automations) shares. A leaf
 * module so `automations.ts` and `orchestration.ts` can both import them
 * without an import cycle; `orchestration.ts` re-exports the public names.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { ProviderModelId, ProviderOptionSelections } from "./model.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/**
 * `ModelSelection` — selection of a model on a configured provider instance.
 *
 * The routing key is `instanceId` (a user-defined slug identifying one
 * configured provider instance). Drivers, credentials, working-directory
 * bindings, and any other per-instance state are recovered from the
 * runtime registry via the instance id.
 *
 * Wire legacy: persisted selections produced before the driver/instance
 * split carried a `provider: <driver-id>` field instead. The schema absorbs
 * that shape via a pre-decoding transform — `{provider, model}` is promoted
 * to `{instanceId: defaultInstanceIdForDriver(provider), model}`. No
 * post-decode compatibility code lives in the runtime; the transform is the
 * only compat surface.
 */
const ModelSelectionWire = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: ProviderModelId,
  options: Schema.optionalKey(ProviderOptionSelections),
});

// Source shape for persisted legacy payloads. Fields are typed as
// `Schema.Unknown` so malformed drafts still make it into the transform and
// fail validation through the target schema (with proper error messages)
// rather than at the source-struct layer where the error is less actionable.
const ModelSelectionSource = Schema.Struct({
  provider: Schema.optional(Schema.Unknown),
  instanceId: Schema.optional(Schema.Unknown),
  model: Schema.Unknown,
  options: Schema.optional(Schema.Unknown),
});

export const ModelSelection = ModelSelectionSource.pipe(
  Schema.decodeTo(
    ModelSelectionWire,
    SchemaTransformation.transformOrFail({
      decode: (raw) => {
        // Resolve the routing key: prefer an explicit `instanceId`; fall
        // back to promoting the legacy `provider` slug (the canonical
        // `defaultInstanceIdForDriver` mapping) so persisted rollout-era
        // payloads decode without data loss. The target schema brands the
        // string as `ProviderInstanceId`.
        const instanceIdSource =
          raw.instanceId !== undefined
            ? raw.instanceId
            : typeof raw.provider === "string"
              ? raw.provider
              : undefined;
        const base: Record<string, unknown> = {
          instanceId: instanceIdSource,
          model: raw.model,
        };
        if (raw.options !== undefined) base.options = raw.options;
        return Effect.succeed(base as typeof ModelSelectionWire.Encoded);
      },
      encode: (value) => {
        const base: Record<string, unknown> = {
          model: value.model,
          instanceId: value.instanceId,
        };
        if (value.options !== undefined) base.options = value.options;
        return Effect.succeed(base as typeof ModelSelectionSource.Encoded);
      },
    }),
  ),
);
export type ModelSelection = typeof ModelSelection.Type;

export const RuntimeMode = Schema.Literals([
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
  // Historical Kimi-only spelling of full access. Persist it so old threads
  // still decode; clients remap it to "full-access" for every known driver.
  "yolo",
]);
export type RuntimeMode = typeof RuntimeMode.Type;
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "full-access";

// "yolo" was Kimi-only. Remap it to generic "full-access" whenever the
// destination provider is known. A missing driver keeps the stored mode so
// a stale lookup cannot invent a different access level.
export function resolveRuntimeModeForProviderDriver(
  providerDriver: string | null | undefined,
  runtimeMode: RuntimeMode,
): RuntimeMode {
  return runtimeMode === "yolo" && providerDriver != null && providerDriver !== "unconfigured"
    ? "full-access"
    : runtimeMode;
}

export function displayRuntimeModeForProviderDriver(
  providerDriver: string | null | undefined,
  runtimeMode: RuntimeMode,
): RuntimeMode {
  return resolveRuntimeModeForProviderDriver(providerDriver, runtimeMode);
}

export function defaultRuntimeModeForProviderDriver(
  _providerDriver: string | null | undefined,
): RuntimeMode {
  return DEFAULT_RUNTIME_MODE;
}

// Compose the provider default with the historical yolo remap. Pass `null`
// when the mode is still unset so every driver inherits full-access.
export function effectiveRuntimeModeForProviderDriver(
  providerDriver: string | null | undefined,
  runtimeMode: RuntimeMode | null | undefined,
): RuntimeMode {
  return displayRuntimeModeForProviderDriver(
    providerDriver,
    runtimeMode ?? defaultRuntimeModeForProviderDriver(providerDriver),
  );
}
