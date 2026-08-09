import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import {
  makeKimiCapabilitiesCacheKey,
  makeKimiContinuationGroupKey,
  makeKimiEnvironment,
  resolveKimiHomePath,
} from "./KimiHome.ts";

it.layer(NodeServices.layer)("KimiHome", (it) => {
  it.effect("uses the standard Kimi data directory by default", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const baseEnvironment = {};
      expect(yield* resolveKimiHomePath({ homePath: "" }, baseEnvironment)).toBe(
        path.resolve(NodeOS.homedir(), ".kimi-code"),
      );
      expect(yield* makeKimiEnvironment({ homePath: "" }, baseEnvironment)).toBe(baseEnvironment);
    }),
  );

  it.effect("honors KIMI_CODE_HOME and isolates continuation/cache keys", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const configured = "~/.kimi-code-work";
      const resolved = path.resolve(NodeOS.homedir(), ".kimi-code-work");
      const config = { binaryPath: "kimi", homePath: configured };

      expect((yield* makeKimiEnvironment(config, {})).KIMI_CODE_HOME).toBe(resolved);
      expect(yield* makeKimiContinuationGroupKey(config, {})).toBe(`kimi:home:${resolved}`);
      expect(yield* makeKimiCapabilitiesCacheKey(config, "/repo", {})).toBe(
        `kimi\0${resolved}\0/repo`,
      );
    }),
  );

  it.effect("uses an inherited KIMI_CODE_HOME when the provider field is empty", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const inherited = path.resolve(NodeOS.tmpdir(), "kimi-inherited");
      expect(yield* resolveKimiHomePath({ homePath: "" }, { KIMI_CODE_HOME: inherited })).toBe(
        inherited,
      );
    }),
  );
});
