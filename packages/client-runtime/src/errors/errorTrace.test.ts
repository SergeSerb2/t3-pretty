import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { findErrorTraceId } from "./errorTrace.ts";

describe("findErrorTraceId", () => {
  it("finds trace metadata through wrapped typed errors", () => {
    expect(
      findErrorTraceId({
        cause: {
          cause: {
            _tag: "RelayInternalError",
            traceId: "trace-relay",
          },
        },
      }),
    ).toBe("trace-relay");
  });

  it("terminates for cyclic causes", () => {
    const error: { cause?: unknown } = {};
    error.cause = error;

    expect(findErrorTraceId(error)).toBeNull();
  });

  it("finds trace metadata in Effect cause branches", () => {
    const cause = Cause.fromReasons<unknown>([
      Cause.makeFailReason(new Error("first failure")),
      Cause.makeFailReason({ traceId: "trace-secondary" }),
    ]);

    expect(findErrorTraceId(cause)).toBe("trace-secondary");
  });

  it("finds trace metadata in aggregate error branches", () => {
    const error = new AggregateError(
      [new Error("first failure"), { traceId: "trace-aggregate" }],
      "request failed",
    );

    expect(findErrorTraceId(error)).toBe("trace-aggregate");
  });

  it("continues through hostile error accessors without throwing", () => {
    const error = Object.create(null) as Record<string, unknown>;
    Object.defineProperties(error, {
      traceId: {
        get: () => {
          throw new Error("hostile trace getter");
        },
      },
      errors: {
        get: () => {
          throw new Error("hostile aggregate getter");
        },
      },
      cause: {
        value: { traceId: "  trace-nested  " },
      },
    });

    expect(findErrorTraceId(error)).toBe("trace-nested");
  });

  it("bounds aggregate traversal before materializing a hostile collection", () => {
    let reads = 0;
    const errors = new Proxy(Array<unknown>(10_000).fill(null), {
      get: (target, property, receiver) => {
        reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    expect(findErrorTraceId({ errors })).toBeNull();
    expect(reads).toBeLessThanOrEqual(128);
  });

  it("reserves traversal capacity for the direct cause", () => {
    expect(
      findErrorTraceId({
        errors: Array<unknown>(10_000).fill(null),
        cause: { traceId: "trace-direct-cause" },
      }),
    ).toBe("trace-direct-cause");
  });

  it("ignores oversized trace identifiers and keeps searching", () => {
    expect(
      findErrorTraceId({
        traceId: `trace-${"x".repeat(256)}`,
        cause: { traceId: "trace-bounded" },
      }),
    ).toBe("trace-bounded");
  });
});
