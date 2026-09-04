import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { FileSizeLimitExceededError, readTextWithinLimit } from "./boundedFileRead.ts";

describe("bounded server file reads", () => {
  it.effect("reads a complete file within the byte budget", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-bounded-read-" });
      const filePath = `${directory}/settings.json`;
      yield* fileSystem.writeFileString(filePath, "héllo");

      assert.equal(yield* readTextWithinLimit(fileSystem, filePath, 6), "héllo");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("rejects an oversized file without reading its remainder", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-bounded-read-" });
      const filePath = `${directory}/settings.json`;
      yield* fileSystem.writeFileString(filePath, "oversized");

      const error = yield* readTextWithinLimit(fileSystem, filePath, 8).pipe(Effect.flip);
      assert.instanceOf(error, FileSizeLimitExceededError);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );
});
