import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_TERMINAL_ID } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ProcessRunner from "../../processRunner.ts";
import * as TerminalManager from "../Manager.ts";

const dataListeners = new Set();
const exitListeners = new Set();
const mode = process.argv[2] ?? "attach";
const pty = {
  pid: 9000,
  write() {},
  resize() {},
  kill() {
    for (const listener of exitListeners) listener({ exitCode: 0, signal: 0 });
  },
  onData(listener) {
    dataListeners.add(listener);
    return () => dataListeners.delete(listener);
  },
  onExit(listener) {
    exitListeners.add(listener);
    return () => exitListeners.delete(listener);
  },
};
function output(data) {
  for (const listener of dataListeners) listener(data);
}

const retained = await Effect.runPromise(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-attach-retention-" });
    const manager = yield* TerminalManager.makeWithOptions({
      logsDir: path.join(directory, "logs"),
      historyLineLimit: 5,
      historyByteLimit: 1024,
      env: {},
      shellResolver: () => "/bin/sh",
      ptyAdapter: { spawn: () => Effect.succeed(pty) },
      subprocessInspector: () =>
        Effect.succeed({ hasRunningSubprocess: false, childCommand: null, processIds: [pty.pid] }),
      subprocessPollIntervalMs: 86_400_000,
    });
    const input = {
      threadId: "attach-memory",
      terminalId: DEFAULT_TERMINAL_ID,
      cwd: directory,
      cols: 80,
      rows: 24,
    };
    yield* manager.open(input);
    const published = yield* Deferred.make();
    const live = yield* Deferred.make();
    let bufferedEvent;
    const stopObserving = yield* manager.subscribe((event) => {
      if (
        mode === "metadata-interrupted" &&
        event.type === "started" &&
        event.threadId === "leak-probe"
      ) {
        bufferedEvent = new WeakRef(event);
        return Deferred.succeed(published, undefined).pipe(Effect.asVoid);
      }
      if (event.type !== "output") return Effect.void;
      if (event.data.startsWith("buffered-")) bufferedEvent = new WeakRef(event);
      return event.data.startsWith("buffered-")
        ? Deferred.succeed(published, undefined).pipe(Effect.asVoid)
        : Deferred.succeed(live, undefined).pipe(Effect.asVoid);
    });
    const receive = (event) => {
      if (event.type === "snapshot") {
        return Effect.sync(() => output(`buffered-${"x".repeat(1_048_576)}`)).pipe(
          Effect.andThen(Deferred.await(published)),
        );
      }
      if (event.type === "output" && event.data.startsWith("buffered-")) {
        bufferedEvent = new WeakRef(event);
      }
      return Effect.void;
    };
    const subscribe = (listener) =>
      mode.startsWith("metadata")
        ? manager.subscribeMetadata(listener)
        : manager.observeStream(input, listener);
    let unsubscribe = () => {};
    if (mode.endsWith("interrupted")) {
      const started = yield* Deferred.make();
      const startup = yield* subscribe((event) =>
        event.type === "snapshot"
          ? Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
          : Effect.void,
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(startup);
      if (mode === "metadata-interrupted") {
        yield* manager.open({ ...input, threadId: "leak-probe" });
      } else {
        output(`buffered-${"x".repeat(1_048_576)}`);
      }
      yield* Deferred.await(published);
    } else {
      unsubscribe = yield* subscribe(receive);
    }
    // Complete another publication so no active output worker needs the old event.
    output("live-output");
    yield* Deferred.await(live);
    stopObserving();
    if (!bufferedEvent) throw new Error("The attach buffer was not exercised");
    yield* Effect.promise(async () => {
      for (let index = 0; index < 8; index++) {
        await new Promise((resolve) => setImmediate(resolve));
        global.gc();
      }
    });
    const isRetained = bufferedEvent.deref() !== undefined;
    // Keep the real subscription and manager alive throughout the GC check.
    unsubscribe();
    return isRetained;
  }).pipe(Effect.scoped, Effect.provide(ProcessRunner.layer), Effect.provide(NodeServices.layer)),
);
console.log(JSON.stringify({ retained }));
