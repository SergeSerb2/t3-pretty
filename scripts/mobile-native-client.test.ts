import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { describe, expect } from "vite-plus/test";

import { installedBinary } from "./mobile-native-client.ts";

describe("fork development client detection", () => {
  it.effect("recognizes and hashes the installed fork iOS app", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const app = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-client-" });
      yield* fs.writeFileString(path.join(app, "T3PrettyDev"), "installed executable");
      const result = yield* installedBinary("ios", "simulator", (_program, args) =>
        Effect.succeed(args[1] === "listapps" ? '"com.sergeserbinenko.t3pretty.dev"' : app),
      );
      expect(result).toMatch(/^[a-f0-9]{64}$/);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("recognizes and hashes the installed fork Android APK", () =>
    Effect.gen(function* () {
      const result = yield* installedBinary("android", "emulator-5554", (_program, args) => {
        if (args.includes("list"))
          return Effect.succeed("package:com.sergeserbinenko.t3pretty.dev");
        if (args.includes("path")) return Effect.succeed("package:/data/app/t3/base.apk");
        return Effect.succeed(`${"a".repeat(64)}  /data/app/t3/base.apk`);
      });
      expect(result).toMatch(/^[a-f0-9]{64}$/);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
