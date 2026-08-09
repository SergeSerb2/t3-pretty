import * as NodeOS from "node:os";

import type { KimiSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { expandHomePath } from "../../pathExpansion.ts";

export const resolveKimiHomePath = Effect.fn("resolveKimiHomePath")(function* (
  config: Pick<KimiSettings, "homePath">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<string, never, Path.Path> {
  const path = yield* Path.Path;
  const configuredHome = config.homePath.trim();
  const environmentHome = baseEnv?.KIMI_CODE_HOME?.trim() ?? process.env.KIMI_CODE_HOME?.trim();
  const homePath =
    configuredHome.length > 0
      ? configuredHome
      : environmentHome && environmentHome.length > 0
        ? environmentHome
        : path.join(NodeOS.homedir(), ".kimi-code");
  return path.resolve(expandHomePath(homePath));
});

export const makeKimiEnvironment = Effect.fn("makeKimiEnvironment")(function* (
  config: Pick<KimiSettings, "homePath">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<NodeJS.ProcessEnv, never, Path.Path> {
  const resolvedBaseEnv = baseEnv ?? process.env;
  const configuredHome = config.homePath.trim();
  if (configuredHome.length === 0) {
    return resolvedBaseEnv;
  }
  return {
    ...resolvedBaseEnv,
    KIMI_CODE_HOME: yield* resolveKimiHomePath(config, resolvedBaseEnv),
  };
});

export const makeKimiContinuationGroupKey = Effect.fn("makeKimiContinuationGroupKey")(function* (
  config: Pick<KimiSettings, "homePath">,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<string, never, Path.Path> {
  const resolvedHomePath = yield* resolveKimiHomePath(config, baseEnv);
  return `kimi:home:${resolvedHomePath}`;
});

export const makeKimiCapabilitiesCacheKey = Effect.fn("makeKimiCapabilitiesCacheKey")(function* (
  config: Pick<KimiSettings, "binaryPath" | "homePath">,
  cwd?: string,
  baseEnv?: NodeJS.ProcessEnv,
): Effect.fn.Return<string, never, Path.Path> {
  const resolvedHomePath = yield* resolveKimiHomePath(config, baseEnv);
  return `${config.binaryPath}\0${resolvedHomePath}\0${cwd ?? ""}`;
});
