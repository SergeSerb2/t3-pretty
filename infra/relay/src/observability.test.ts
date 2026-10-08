import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";

import * as EnvironmentConnector from "./environments/EnvironmentConnector.ts";
import * as Observability from "./observability.ts";

class OversizedTraceError extends Schema.TaggedError<OversizedTraceError>()("OversizedTraceError", {
  detail: Schema.String,
  values: Schema.Array(Schema.String),
  cause: Schema.Defect(),
}) {}

it("bounds schema error attributes without inspecting the defect cause", () => {
  const attributes = Observability.schemaErrorAttributes(
    new OversizedTraceError({
      detail: "d".repeat(Observability.RELAY_SCHEMA_ERROR_ATTRIBUTE_STRING_MAX_LENGTH + 1_000),
      values: Array.from(
        { length: Observability.RELAY_SCHEMA_ERROR_ATTRIBUTE_ARRAY_MAX_COUNT + 100 },
        (_, index) =>
          `${index}:${"v".repeat(Observability.RELAY_SCHEMA_ERROR_ATTRIBUTE_STRING_MAX_LENGTH + 1)}`,
      ),
      cause: {
        toJSON: () => {
          throw new Error("the defect cause must not be serialized");
        },
      },
    }),
  );

  expect(attributes?.["error.type"]).toBe("OversizedTraceError");
  expect(attributes?.["error.detail"]).toHaveLength(
    Observability.RELAY_SCHEMA_ERROR_ATTRIBUTE_STRING_MAX_LENGTH,
  );
  expect(attributes?.["error.values"]).toHaveLength(
    Observability.RELAY_SCHEMA_ERROR_ATTRIBUTE_ARRAY_MAX_COUNT,
  );
  const values = attributes?.["error.values"];
  expect(Array.isArray(values)).toBe(true);
  if (Array.isArray(values)) {
    expect(values[0]).toHaveLength(Observability.RELAY_SCHEMA_ERROR_ATTRIBUTE_STRING_MAX_LENGTH);
  }
  expect(attributes).not.toHaveProperty("error.cause");
});

it.effect("adds schema error fields to spans on the current tracer", () =>
  Effect.gen(function* () {
    const spans: Array<Tracer.NativeSpan> = [];
    const tracer = Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    });

    yield* Effect.fail(
      new EnvironmentConnector.EnvironmentConnectNotAuthorized({
        environmentId: "environment-1",
        operation: "connect",
        reason: "managed_endpoint_allocation_not_ready",
      }),
    ).pipe(
      Effect.withSpan("relay.test.schema_error"),
      Effect.exit,
      Observability.withSchemaErrorSpanAttributes,
      Effect.withTracer(tracer),
    );

    expect(spans.map((span) => span.name)).toEqual(["relay.test.schema_error"]);
    expect(Object.fromEntries(spans[0]!.attributes)).toMatchObject({
      "error.type": "EnvironmentConnectNotAuthorized",
      "error.environmentId": "environment-1",
      "error.operation": "connect",
      "error.reason": "managed_endpoint_allocation_not_ready",
    });
  }),
);
