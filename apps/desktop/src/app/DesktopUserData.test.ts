import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect("keeps Pretty V2 profiles separate and copies only Pretty Windows preferences", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "pretty-v2-profile-" });
    yield* fs.makeDirectory(path.join(directory, "t3pretty", "IndexedDB"), { recursive: true });
    yield* fs.makeDirectory(path.join(directory, "t3code"), { recursive: true });
    yield* fs.writeFileString(
      path.join(directory, "t3pretty", "Local State"),
      "Pretty preferences",
    );
    yield* fs.writeFileString(
      path.join(directory, "t3code", "Local State"),
      "upstream preferences",
    );
    const selected = yield* resolveUserDataPath({
      appDataDirectory: directory,
      isDevelopment: false,
      platform: "win32",
      appUserModelId: "com.sergeserb.t3pretty",
    });
    assert.equal(selected, path.join(directory, "t3pretty-v2"));
    assert.equal(
      yield* fs.readFileString(path.join(selected, "Local State")),
      "Pretty preferences",
    );
    assert.isFalse(yield* fs.exists(path.join(selected, "IndexedDB")));
    assert.equal(
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "darwin",
        appUserModelId: "com.sergeserb.t3pretty",
      }),
      selected,
    );
    assert.equal(
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: true,
        platform: "darwin",
        appUserModelId: "com.sergeserb.t3pretty.dev",
      }),
      path.join(directory, "t3pretty-dev"),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("identifies a failed source read and preserves its cause", () => {
  const sourceState = "/profiles/t3code/Local State";
  const cause = PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: "readFileString",
    pathOrDescriptor: sourceState,
  });
  return Effect.gen(function* () {
    const error = yield* resolveUserDataPath({
      appDataDirectory: "/profiles",
      isDevelopment: false,
      platform: "win32",
    }).pipe(Effect.flip);
    assert.equal(error.operation, "read");
    assert.equal(error.resourcePath, sourceState);
    assert.equal(error.category, "PermissionDenied");
    assert.strictEqual(error.cause, cause);
  }).pipe(
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        exists: (path) => Effect.succeed(path === sourceState),
        readFileString: () => Effect.fail(cause),
      }),
    ),
    Effect.provide(NodeServices.layer),
  );
});

for (const sourceName of ["t3code", "T3 Code (Alpha)"]) {
  it.effect(
    `preserves Windows credential keys from ${sourceName} without copying browser databases`,
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-v2-profile-" });
        const source = path.join(directory, sourceName);
        const destination = path.join(directory, "t3code-v2");
        const state = '{"os_crypt":{"encrypted_key":"test-encrypted-key"}}';
        yield* fs.makeDirectory(path.join(directory, "T3 Code (Alpha)"), { recursive: true });
        yield* fs.makeDirectory(path.join(source, "IndexedDB"), { recursive: true });
        yield* fs.writeFileString(path.join(source, "Local State"), state);
        yield* fs.writeFileString(path.join(source, "IndexedDB", "LOCK"), "V1 owns this database");
        yield* resolveUserDataPath({
          appDataDirectory: directory,
          isDevelopment: false,
          platform: "win32",
        });
        assert.equal(yield* fs.readFileString(path.join(destination, "Local State")), state);
        assert.equal(yield* fs.readFileString(path.join(source, "Local State")), state);
        assert.isFalse(yield* fs.exists(path.join(destination, "IndexedDB")));
        yield* fs.writeFileString(path.join(destination, "Local State"), "existing V2 state");
        yield* resolveUserDataPath({
          appDataDirectory: directory,
          isDevelopment: false,
          platform: "win32",
        });
        assert.equal(
          yield* fs.readFileString(path.join(destination, "Local State")),
          "existing V2 state",
        );
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
}
