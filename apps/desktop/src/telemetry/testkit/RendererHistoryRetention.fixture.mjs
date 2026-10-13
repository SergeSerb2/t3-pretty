import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import { DesktopEnvironment } from "../../app/DesktopEnvironment.ts";
import * as DesktopRendererHistory from "../DesktopRendererHistory.ts";

const releaseWriter = Promise.withResolvers();
const writerStarted = Promise.withResolvers();
const historyLayer = DesktopRendererHistory.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(DesktopEnvironment, { logDir: "/unused-renderer-retention" }),
      Path.layer,
      FileSystem.layerNoop({
        makeDirectory: () => Effect.void,
        readDirectory: () => Effect.succeed([]),
        writeFile: () =>
          Effect.promise((_signal) => {
            writerStarted.resolve();
            return releaseWriter.promise;
          }),
      }),
    ),
  ),
);

async function enqueue(history, index) {
  const message = `${index}:` + "x".repeat(16 * 1024 * 1024);
  message.charCodeAt(message.length - 1);
  await Effect.runPromise(history.recordError({ event: "window-error", message }));
}

await Effect.runPromise(
  Effect.gen(function* () {
    const history = yield* DesktopRendererHistory.DesktopRendererHistory;
    yield* history.recordError({ event: "window-error", message: "warmup" });
    yield* Effect.promise(() => writerStarted.promise);
    yield* Effect.promise(async () => {
      global.gc();
      const baseline = process.memoryUsage().heapUsed;
      for (let index = 0; index < 6; index++) await enqueue(history, index);
      for (let index = 0; index < 3; index++) {
        await new Promise(setImmediate);
        global.gc();
      }
      const retainedBytes = process.memoryUsage().heapUsed - baseline;
      console.log(JSON.stringify({ queuedPayloadBytes: 6 * 16 * 1024 * 1024, retainedBytes }));
    }).pipe(Effect.ensuring(Effect.sync(() => releaseWriter.resolve())));
  }).pipe(
    Effect.provide(historyLayer),
    Effect.provide(Logger.layer([], { mergeWithExisting: false })),
    Effect.scoped,
  ),
);
