import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { HttpClient } from "effect/unstable/http";
import { Atom } from "effect/unstable/reactivity";

import { EnvironmentId } from "@t3tools/contracts";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentSessionAtoms,
  initialConfigOption,
  SESSION_STATE_IDLE_TTL_MS,
} from "./session.ts";

class TestConfigError extends Schema.TaggedErrorClass<TestConfigError>()("TestConfigError", {
  message: Schema.String,
}) {}

describe("environment session state", () => {
  it("releases idle environment session subscriptions", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry | HttpClient.HttpClient,
      never
    >;
    const atoms = createEnvironmentSessionAtoms(runtime);
    const environmentId = EnvironmentId.make("environment-1");

    expect(atoms.initialConfigAtom(environmentId).idleTTL).toBe(SESSION_STATE_IDLE_TTL_MS);
    expect(atoms.preparedConnectionAtom(environmentId).idleTTL).toBe(SESSION_STATE_IDLE_TTL_MS);
    expect(atoms.sessionStateAtom(environmentId).idleTTL).toBe(SESSION_STATE_IDLE_TTL_MS);
  });

  it.effect("turns an initial config failure into an empty value", () =>
    Effect.gen(function* () {
      const result = yield* initialConfigOption(
        Effect.fail(new TestConfigError({ message: "temporary failure" })),
      );
      expect(Option.isNone(result)).toBe(true);
    }),
  );
});
