import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Tracer from "effect/Tracer";
import { afterEach, expect, it } from "@effect/vitest";

import * as ClientTracer from "./clientTracer";

afterEach(() => ClientTracer.setDelegate(null));

it.effect.each(["native", "delegate"])("preserves client results and failure causes (%s)", (mode) =>
  Effect.gen(function* () {
    if (mode === "delegate") {
      ClientTracer.setDelegate(Tracer.make({ span: (options) => new Tracer.NativeSpan(options) }));
    }
    const result = { messages: ["Conversation data"] };
    let span: Tracer.Span | undefined;
    const value = yield* Effect.gen(function* () {
      span = yield* Effect.currentSpan;
      return result;
    }).pipe(Effect.withSpan("client-success"), Effect.provide(ClientTracer.layer));
    expect(value).toBe(result);
    expect(span?.status._tag).toBe("Ended");
    if (span?.status._tag === "Ended") expect(span.status.exit).toEqual(Exit.void);

    const error = new Error("Failed request");
    const failed = yield* Effect.exit(
      Effect.gen(function* () {
        span = yield* Effect.currentSpan;
        return yield* Effect.fail(error);
      }).pipe(Effect.withSpan("client-failure"), Effect.provide(ClientTracer.layer)),
    );
    expect(Exit.isFailure(failed)).toBe(true);
    expect(span?.status._tag).toBe("Ended");
    if (span?.status._tag === "Ended") expect(span.status.exit).toEqual(failed);
  }),
);
