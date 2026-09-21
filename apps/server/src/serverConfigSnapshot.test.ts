import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { resolveRemoteOpenTargetsForConfig } from "./serverConfigSnapshot.ts";

it.effect("keeps discovered remote-open targets in the server config", () =>
  Effect.gen(function* () {
    const targets = [{ kind: "mdns" as const, host: "workstation.local" }];
    const resolved = yield* resolveRemoteOpenTargetsForConfig(Effect.succeed(targets));

    expect(resolved).toEqual(targets);
  }),
);
