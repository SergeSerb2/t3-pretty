import type { ProviderInstanceEnvironment } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import { expandHomePath } from "./pathExpansion.ts";

export function prependGlobalEnvironment(
  globalEnvironment: ProviderInstanceEnvironment | undefined,
  instanceEnvironment: ProviderInstanceEnvironment | undefined,
): ProviderInstanceEnvironment | undefined {
  if (globalEnvironment === undefined || globalEnvironment.length === 0) {
    return instanceEnvironment;
  }
  if (instanceEnvironment === undefined || instanceEnvironment.length === 0) {
    return globalEnvironment;
  }
  return [...globalEnvironment, ...instanceEnvironment];
}

/** Overlay a resolved instance env onto `process.env`. Globals are already prepended on that list. */
export const mergeProviderInstanceEnvironment = Effect.fn(function* (
  environment: ProviderInstanceEnvironment | undefined,
  baseEnv: NodeJS.ProcessEnv = process.env,
) {
  if (!environment || environment.length === 0) {
    return baseEnv;
  }

  const home = yield* HostProcess.HomeDirectory;
  const next: NodeJS.ProcessEnv = { ...baseEnv };
  for (const variable of environment) {
    // Child processes do not apply shell expansion to environment values.
    next[variable.name] =
      variable.name === "CODEX_HOME" || variable.name === "CLAUDE_CONFIG_DIR"
        ? expandHomePath(variable.value, home)
        : variable.value;
  }
  return next;
});
