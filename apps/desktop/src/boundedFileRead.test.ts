import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { DesktopFileSizeLimitExceededError, readFileStringWithinLimit } from "./boundedFileRead.ts";

describe("bounded desktop file reads", () => {
  it.effect("reads complete files within the byte budget", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-bounded-read-" });
      const filePath = `${directory}/settings.json`;
      yield* fileSystem.writeFileString(filePath, "héllo");

      assert.equal(yield* readFileStringWithinLimit(fileSystem, filePath, 6), "héllo");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("rejects a file before reading it past the byte budget", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-bounded-read-" });
      const filePath = `${directory}/settings.json`;
      yield* fileSystem.writeFileString(filePath, "oversized");

      const error = yield* readFileStringWithinLimit(fileSystem, filePath, 8).pipe(Effect.flip);
      assert.instanceOf(error, DesktopFileSizeLimitExceededError);
      assert.equal(error.actualBytes, 9n);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
