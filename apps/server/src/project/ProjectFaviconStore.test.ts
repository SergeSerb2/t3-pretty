// @effect-diagnostics nodeBuiltinImport:off
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectImportFaviconError } from "@t3tools/contracts";
import { MANAGED_PROJECT_FAVICON_REVISION_LENGTH } from "@t3tools/shared/projectFavicon";
import { describe, expect, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import {
  importProjectFavicon,
  removeStaleManagedProjectFavicons,
  resolveManagedProjectFaviconFile,
  toSafeProjectIconSegment,
} from "./ProjectFaviconStore.ts";

const configLayer = ServerConfig.ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-project-favicon-store-",
});
const testLayer = configLayer.pipe(Layer.provideMerge(NodeServices.layer));

const svgBytes = "<svg>icon</svg>";
const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(svgBytes).toString("base64")}`;

const contentRevision = (bytes: string) =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const hex = yield* crypto
      .digest("SHA-256", Buffer.from(bytes))
      .pipe(Effect.map(Encoding.encodeHex));
    return hex.slice(0, MANAGED_PROJECT_FAVICON_REVISION_LENGTH);
  });

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
      const revision = yield* contentRevision(svgBytes);

      const result = yield* importProjectFavicon({
        projectId,
        fileName: "/Users/ada/Pictures/Logo.SVG",
        dataUrl: svgDataUrl,
      });

      expect(result.faviconPath).toBe(`t3-project-icon/${revision}-Logo.svg`);
      expect(result.created).toBe(true);
      const storedPath = yield* resolveManagedProjectFaviconFile({
        projectId,
        faviconPath: result.faviconPath,
      });
      expect(storedPath).toBe(
        yield* fileSystem.realPath(
          path.join(
            config.projectIconsDir,
            `${toSafeProjectIconSegment(projectId)}.${revision}.svg`,
          ),
        ),
      );
      expect(yield* fileSystem.readFileString(storedPath!)).toBe(svgBytes);
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

  it.effect("writes a replacement before deleting the previous icon", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const projectId = "project-favicon-3";
      const svg = yield* importProjectFavicon({
        projectId,
        fileName: "logo.svg",
        dataUrl: svgDataUrl,
      });
      const pngBytes = "png-bytes";
      const pngDataUrl = `data:image/png;base64,${Buffer.from(pngBytes).toString("base64")}`;
      const png = yield* importProjectFavicon({
        projectId,
        fileName: "logo.png",
        dataUrl: pngDataUrl,
      });

      expect(png.faviconPath).not.toBe(svg.faviconPath);
      expect(
        yield* resolveManagedProjectFaviconFile({
          projectId,
          faviconPath: svg.faviconPath,
        }),
      ).not.toBeNull();
      const storedPath = yield* resolveManagedProjectFaviconFile({
        projectId,
        faviconPath: png.faviconPath,
      });
      expect(storedPath).not.toBeNull();
      expect(Array.from(yield* fileSystem.readFile(storedPath!))).toEqual(
        Array.from(Buffer.from(pngBytes)),
      );

      yield* removeStaleManagedProjectFavicons({
        projectId,
        keepFaviconPath: png.faviconPath,
      });
      expect(
        yield* resolveManagedProjectFaviconFile({
          projectId,
          faviconPath: svg.faviconPath,
        }),
      ).toBeNull();
      expect(
        yield* resolveManagedProjectFaviconFile({
          projectId,
          faviconPath: png.faviconPath,
        }),
      ).not.toBeNull();
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("versions the managed path when the same file name is replaced", () =>
    Effect.gen(function* () {
      const projectId = "project-favicon-4";
      const first = yield* importProjectFavicon({
        projectId,
        fileName: "logo.svg",
        dataUrl: svgDataUrl,
      });
      const nextBytes = "<svg>replacement</svg>";
      const second = yield* importProjectFavicon({
        projectId,
        fileName: "logo.svg",
        dataUrl: `data:image/svg+xml;base64,${Buffer.from(nextBytes).toString("base64")}`,
      });

      expect(second.faviconPath).not.toBe(first.faviconPath);
      expect(second.faviconPath).toMatch(/^t3-project-icon\/[0-9a-f]{16}-logo\.svg$/);
      expect(
        yield* resolveManagedProjectFaviconFile({
          projectId,
          faviconPath: first.faviconPath,
        }),
      ).not.toBeNull();
      expect(
        yield* resolveManagedProjectFaviconFile({
          projectId,
          faviconPath: second.faviconPath,
        }),
      ).not.toBeNull();
    }).pipe(Effect.provide(testLayer)),
  );
});
