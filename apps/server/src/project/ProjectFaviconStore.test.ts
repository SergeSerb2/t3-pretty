// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectImportFaviconError } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import {
  importProjectFavicon,
  resolveManagedProjectFaviconFile,
  toSafeProjectIconSegment,
} from "./ProjectFaviconStore.ts";

const configLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-project-favicon-store-",
});
const testLayer = configLayer.pipe(Layer.provideMerge(NodeServices.layer));

const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from("<svg>icon</svg>").toString("base64")}`;

describe("ProjectFaviconStore", () => {
  it("sanitizes project ids for icon filenames", () => {
    expect(toSafeProjectIconSegment("Project 1")).toBe("project-1");
    expect(toSafeProjectIconSegment("...")).toBeNull();
  });

  it.effect("stores a picked image under T3 home and resolves it back", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const projectId = "project-favicon-1";

      const result = yield* importProjectFavicon({
        projectId,
        fileName: "/Users/ada/Pictures/Logo.SVG",
        dataUrl: svgDataUrl,
      });

      expect(result.faviconPath).toBe("t3-project-icon/Logo.svg");
      const storedPath = yield* resolveManagedProjectFaviconFile({
        projectId,
        faviconPath: result.faviconPath,
      });
      expect(storedPath).toBe(
        yield* fileSystem.realPath(
          path.join(config.projectIconsDir, `${toSafeProjectIconSegment(projectId)}.svg`),
        ),
      );
      expect(yield* fileSystem.readFileString(storedPath!)).toBe("<svg>icon</svg>");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects a non-image file name", () =>
    Effect.gen(function* () {
      const error = yield* importProjectFavicon({
        projectId: "project-favicon-2",
        fileName: "secrets.env",
        dataUrl: svgDataUrl,
      }).pipe(Effect.flip);

      expect(error).toBeInstanceOf(ProjectImportFaviconError);
      expect(error.failure).toBe("invalid_image");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("replaces a previous icon when the extension changes", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const projectId = "project-favicon-3";
      yield* importProjectFavicon({
        projectId,
        fileName: "logo.svg",
        dataUrl: svgDataUrl,
      });
      const pngDataUrl = `data:image/png;base64,${Buffer.from("png-bytes").toString("base64")}`;
      const result = yield* importProjectFavicon({
        projectId,
        fileName: "logo.png",
        dataUrl: pngDataUrl,
      });

      expect(result.faviconPath).toBe("t3-project-icon/logo.png");
      expect(
        yield* resolveManagedProjectFaviconFile({
          projectId,
          faviconPath: "t3-project-icon/logo.svg",
        }),
      ).toBeNull();
      const storedPath = yield* resolveManagedProjectFaviconFile({
        projectId,
        faviconPath: result.faviconPath,
      });
      expect(storedPath).not.toBeNull();
      expect(Array.from(yield* fileSystem.readFile(storedPath!))).toEqual(
        Array.from(Buffer.from("png-bytes")),
      );
    }).pipe(Effect.provide(testLayer)),
  );
});
