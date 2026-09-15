import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as References from "effect/References";

import {
  SERVER_TRACE_DIAGNOSTIC_PATH_MAX_LENGTH,
  SERVER_TRACE_DIAGNOSTIC_SCANNED_FILE_MAX_COUNT,
  SERVER_TRACE_DIAGNOSTIC_TEXT_MAX_LENGTH,
} from "@t3tools/contracts";
import * as TraceDiagnostics from "./TraceDiagnostics.ts";

function ns(ms: number): string {
  return String(BigInt(ms) * 1_000_000n);
}

function record(input: {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly startMs: number;
  readonly durationMs: number;
  readonly exit?: { readonly _tag: "Success" | "Failure" | "Interrupted"; readonly cause?: string };
  readonly events?: ReadonlyArray<unknown>;
}) {
  return JSON.stringify({
    type: "effect-span",
    name: input.name,
    traceId: input.traceId,
    spanId: input.spanId,
    sampled: true,
    kind: "internal",
    startTimeUnixNano: ns(input.startMs),
    endTimeUnixNano: ns(input.startMs + input.durationMs),
    durationMs: input.durationMs,
    attributes: {},
    events: input.events ?? [],
    links: [],
    exit: input.exit ?? { _tag: "Success" },
  });
}

describe("TraceDiagnostics", () => {
  it.effect("aggregates failures, slow spans, log levels, and parse errors", () =>
    Effect.sync(() => {
      const diagnostics = TraceDiagnostics.aggregateTraceDiagnostics({
        traceFilePath: "/tmp/server.trace.ndjson",
        readAt: DateTime.makeUnsafe("2026-05-05T10:00:00.000Z"),
        slowSpanThresholdMs: 1_000,
        files: [
          {
            path: "/tmp/server.trace.ndjson.1",
            text: [
              record({
                name: "server.getConfig",
                traceId: "trace-a",
                spanId: "span-a",
                startMs: 1_000,
                durationMs: 50,
              }),
              "not-json",
            ].join("\n"),
          },
          {
            path: "/tmp/server.trace.ndjson",
            text: [
              record({
                name: "orchestration.dispatch",
                traceId: "trace-b",
                spanId: "span-b",
                startMs: 2_000,
                durationMs: 1_500,
                exit: { _tag: "Failure", cause: "Provider crashed" },
                events: [
                  {
                    name: "provider failed",
                    timeUnixNano: ns(3_400),
                    attributes: { "effect.logLevel": "Error" },
                  },
                ],
              }),
              record({
                name: "orchestration.dispatch",
                traceId: "trace-c",
                spanId: "span-c",
                startMs: 4_000,
                durationMs: 250,
                exit: { _tag: "Failure", cause: "Provider crashed" },
              }),
              record({
                name: "git.status",
                traceId: "trace-d",
                spanId: "span-d",
                startMs: 5_000,
                durationMs: 25,
                exit: { _tag: "Interrupted", cause: "Interrupted" },
                events: [
                  {
                    name: "status delayed",
                    timeUnixNano: ns(5_010),
                    attributes: { "effect.logLevel": "Warning" },
                  },
                ],
              }),
            ].join("\n"),
          },
        ],
      });

      assert.equal(diagnostics.recordCount, 4);
      assert.equal(DateTime.formatIso(diagnostics.readAt), "2026-05-05T10:00:00.000Z");
      assert.equal(
        Option.match(diagnostics.firstSpanAt, {
          onNone: () => null,
          onSome: DateTime.formatIso,
        }),
        "1970-01-01T00:00:01.000Z",
      );
      assert.equal(
        Option.match(diagnostics.lastSpanAt, {
          onNone: () => null,
          onSome: DateTime.formatIso,
        }),
        "1970-01-01T00:00:05.025Z",
      );
      assert.equal(diagnostics.parseErrorCount, 1);
      assert.equal(diagnostics.failureCount, 2);
      assert.equal(diagnostics.interruptionCount, 1);
      assert.equal(diagnostics.slowSpanCount, 1);
      assert.equal(diagnostics.logLevelCounts.Error, 1);
      assert.equal(diagnostics.logLevelCounts.Warning, 1);
      assert.equal(diagnostics.commonFailures[0]?.name, "orchestration.dispatch");
      assert.equal(diagnostics.commonFailures[0]?.count, 2);
      assert.equal(diagnostics.latestFailures[0]?.traceId, "trace-c");
      assert.equal(diagnostics.slowestSpans[0]?.traceId, "trace-b");
      assert.equal(diagnostics.latestWarningAndErrorLogs[0]?.message, "status delayed");
      assert.equal(diagnostics.topSpansByCount[0]?.name, "orchestration.dispatch");
    }),
  );

  it.effect("returns a not-found diagnostic when no files are available", () =>
    Effect.sync(() => {
      const diagnostics = TraceDiagnostics.aggregateTraceDiagnostics({
        traceFilePath: "/tmp/missing.trace.ndjson",
        readAt: DateTime.makeUnsafe("2026-05-05T10:00:00.000Z"),
        files: [],
      });

      assert.equal(diagnostics.recordCount, 0);
      assert.equal(Option.getOrUndefined(diagnostics.error)?.kind, "trace-file-not-found");
    }),
  );

  it.effect("bounds trace diagnostic paths, errors, and scanned-file metadata", () =>
    Effect.sync(() => {
      const diagnostics = TraceDiagnostics.aggregateTraceDiagnostics({
        traceFilePath: `/${"p".repeat(SERVER_TRACE_DIAGNOSTIC_PATH_MAX_LENGTH + 10)}`,
        scannedFilePaths: Array.from(
          { length: SERVER_TRACE_DIAGNOSTIC_SCANNED_FILE_MAX_COUNT + 1 },
          (_, index) => `/tmp/server.trace.ndjson.${index}`,
        ),
        readAt: DateTime.makeUnsafe("2026-05-05T10:00:00.000Z"),
        files: [],
        error: {
          kind: "trace-file-read-failed",
          message: "e".repeat(SERVER_TRACE_DIAGNOSTIC_TEXT_MAX_LENGTH + 1),
        },
      });

      assert.equal(diagnostics.traceFilePath.length, SERVER_TRACE_DIAGNOSTIC_PATH_MAX_LENGTH);
      assert.equal(
        diagnostics.scannedFilePaths.length,
        SERVER_TRACE_DIAGNOSTIC_SCANNED_FILE_MAX_COUNT,
      );
      assert.equal(
        Option.getOrUndefined(diagnostics.error)?.message.length,
        SERVER_TRACE_DIAGNOSTIC_TEXT_MAX_LENGTH,
      );
    }),
  );

  it.effect("preserves full failure causes and log messages", () =>
    Effect.sync(() => {
      const longCause = `VcsProcessSpawnError: ${"missing executable ".repeat(80)}`.trim();
      const longMessage = `provider warning: ${"retrying command ".repeat(80)}`.trim();
      const diagnostics = TraceDiagnostics.aggregateTraceDiagnostics({
        traceFilePath: "/tmp/server.trace.ndjson",
        readAt: DateTime.makeUnsafe("2026-05-05T10:00:00.000Z"),
        files: [
          {
            path: "/tmp/server.trace.ndjson",
            text: record({
              name: "VcsProcess.run",
              traceId: "trace-long",
              spanId: "span-long",
              startMs: 1_000,
              durationMs: 25,
              exit: { _tag: "Failure", cause: longCause },
              events: [
                {
                  name: longMessage,
                  timeUnixNano: ns(1_010),
                  attributes: { "effect.logLevel": "Warning" },
                },
              ],
            }),
          },
        ],
      });

      assert.equal(diagnostics.latestFailures[0]?.cause, longCause);
      assert.equal(diagnostics.commonFailures[0]?.cause, longCause);
      assert.equal(diagnostics.latestWarningAndErrorLogs[0]?.message, longMessage);
    }),
  );

  it.effect("keeps loaded trace data when one rotated trace file fails to read", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fileSystem.makeTempDirectoryScoped({
          prefix: "t3-trace-diagnostics-",
        });
        const traceFilePath = path.join(directory, "server.trace.ndjson");
        const rotatedTraceFilePath = `${traceFilePath}.1`;
        yield* fileSystem.writeFileString(
          traceFilePath,
          record({
            name: "server.getConfig",
            traceId: "trace-a",
            spanId: "span-a",
            startMs: 1_000,
            durationMs: 50,
          }),
        );
        yield* fileSystem.writeFileString(rotatedTraceFilePath, "unread");

        const readFailure = PlatformError.systemError({
          _tag: "PermissionDenied",
          module: "FileSystem",
          method: "open",
          description: "permission denied",
          pathOrDescriptor: rotatedTraceFilePath,
        });
        const failingFileSystem = FileSystem.FileSystem.of({
          ...fileSystem,
          open: (filePath, options) =>
            filePath === rotatedTraceFilePath
              ? Effect.fail(readFailure)
              : fileSystem.open(filePath, options),
        });
        const traceDiagnostics = yield* TraceDiagnostics.make.pipe(
          Effect.provideService(FileSystem.FileSystem, failingFileSystem),
        );
        const logAnnotations: Array<Record<string, unknown>> = [];
        const logger = Logger.make<unknown, void>((options) => {
          logAnnotations.push({ ...options.fiber.getRef(References.CurrentLogAnnotations) });
        });

        const diagnostics = yield* traceDiagnostics
          .read({
            traceFilePath,
            maxFiles: 1,
            readAt: DateTime.makeUnsafe("2026-05-05T10:00:00.000Z"),
          })
          .pipe(Effect.provide(Logger.layer([logger], { mergeWithExisting: false })));

        assert.equal(diagnostics.recordCount, 1);
        assert.equal(
          Option.getOrElse(diagnostics.partialFailure, () => false),
          true,
        );
        assert.deepStrictEqual(Option.getOrUndefined(diagnostics.error), {
          kind: "trace-file-read-failed",
          message: `Failed to read local trace file '${rotatedTraceFilePath}'.`,
        });
        assert.deepStrictEqual(diagnostics.scannedFilePaths, [rotatedTraceFilePath, traceFilePath]);

        const failureLog = logAnnotations.find(
          (annotations) => annotations.traceFilePath === rotatedTraceFilePath,
        );
        assert.exists(failureLog);
        assert.deepStrictEqual(failureLog, {
          traceFilePath: rotatedTraceFilePath,
          errorTag: "TraceFileReadError",
          causeTag: "PermissionDenied",
        });
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps only the slowest span occurrences while aggregating large inputs", () =>
    Effect.sync(() => {
      const diagnostics = TraceDiagnostics.aggregateTraceDiagnostics({
        traceFilePath: "/tmp/server.trace.ndjson",
        readAt: DateTime.makeUnsafe("2026-05-05T10:00:00.000Z"),
        files: [
          {
            path: "/tmp/server.trace.ndjson",
            text: Array.from({ length: 25 }, (_, index) =>
              record({
                name: `span-${index}`,
                traceId: `trace-${index}`,
                spanId: `span-${index}`,
                startMs: index * 1_000,
                durationMs: index,
              }),
            ).join("\n"),
          },
        ],
      });

      assert.equal(diagnostics.recordCount, 25);
      assert.equal(diagnostics.slowestSpans.length, 10);
      assert.deepStrictEqual(
        diagnostics.slowestSpans.map((span) => span.durationMs),
        [24, 23, 22, 21, 20, 19, 18, 17, 16, 15],
      );
    }),
  );

  it.effect("bounds recent details and safely counts arbitrary log-level keys", () =>
    Effect.sync(() => {
      const diagnostics = TraceDiagnostics.aggregateTraceDiagnostics({
        traceFilePath: "/tmp/server.trace.ndjson",
        readAt: DateTime.makeUnsafe("2026-05-05T10:00:00.000Z"),
        files: [
          {
            path: "/tmp/server.trace.ndjson",
            text: Array.from({ length: 50 }, (_, index) =>
              record({
                name: `span-${index}`,
                traceId: `trace-${index}`,
                spanId: `span-${index}`,
                startMs: index * 1_000,
                durationMs: 25,
                exit: { _tag: "Failure", cause: `failure-${index}` },
                events: [
                  {
                    name: `warning-${index}`,
                    timeUnixNano: ns(index * 1_000 + 10),
                    attributes: { "effect.logLevel": "Warning" },
                  },
                  {
                    name: "arbitrary level",
                    timeUnixNano: ns(index * 1_000 + 11),
                    attributes: { "effect.logLevel": "__proto__" },
                  },
                ],
              }),
            ).join("\n"),
          },
        ],
      });

      assert.equal(diagnostics.latestFailures.length, 20);
      assert.equal(diagnostics.latestFailures[0]?.traceId, "trace-49");
      assert.equal(diagnostics.latestFailures.at(-1)?.traceId, "trace-30");
      assert.equal(diagnostics.latestWarningAndErrorLogs.length, 20);
      assert.equal(diagnostics.latestWarningAndErrorLogs[0]?.message, "warning-49");
      assert.equal(diagnostics.logLevelCounts.Warning, 50);
      assert.equal(diagnostics.logLevelCounts.__proto__, 50);
      assert.equal(Object.hasOwn(diagnostics.logLevelCounts, "__proto__"), true);
    }),
  );
});
