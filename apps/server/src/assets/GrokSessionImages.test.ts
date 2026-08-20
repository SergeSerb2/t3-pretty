import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { grokSessionIdFromResumeCursor, resolveGrokSessionImageFile } from "./GrokSessionImages.ts";

const pngBytes = new Uint8Array([137, 80, 78, 71]);

const writeSessionImage = Effect.fn("writeSessionImage")(function* (input: {
  readonly homeDir: string;
  readonly workspaceRoot: string;
  readonly sessionId: string;
  readonly relativePath?: string;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const relativePath = input.relativePath ?? "images/1.jpg";
  const imagePath = path.join(
    input.homeDir,
    ".grok",
    "sessions",
    encodeURIComponent(input.workspaceRoot),
    input.sessionId,
    relativePath,
  );
  yield* fileSystem.makeDirectory(path.dirname(imagePath), { recursive: true });
  yield* fileSystem.writeFile(imagePath, pngBytes);
  return yield* fileSystem.realPath(imagePath);
});

describe("GrokSessionImages", () => {
  it("reads Grok resume cursors", () => {
    expect(grokSessionIdFromResumeCursor({ schemaVersion: 1, sessionId: "session-1" })).toBe(
      "session-1",
    );
    expect(
      grokSessionIdFromResumeCursor({ schemaVersion: 2, sessionId: "session-1" }),
    ).toBeUndefined();
    expect(grokSessionIdFromResumeCursor(null)).toBeUndefined();
  });

  it.effect("resolves a session-relative image for the workspace", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const homeDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-grok-image-home-",
      });
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-grok-image-workspace-",
      });
      const imagePath = yield* writeSessionImage({
        homeDir,
        workspaceRoot,
        sessionId: "session-1",
      });

      const resolved = yield* resolveGrokSessionImageFile({
        homeDir,
        workspaceRoot,
        requestedPath: "images/1.jpg",
        grokSessionId: "session-1",
      });
      expect(resolved?.file).toBe(imagePath);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("resolves an absolute Grok session path without decoding %2F", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const homeDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-grok-image-abs-home-",
      });
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-grok-image-abs-workspace-",
      });
      const imagePath = yield* writeSessionImage({
        homeDir,
        workspaceRoot,
        sessionId: "session-1",
      });

      const resolved = yield* resolveGrokSessionImageFile({
        homeDir,
        workspaceRoot,
        requestedPath: imagePath,
      });
      expect(resolved?.file).toBe(imagePath);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects images from another workspace's Grok session", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const homeDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-grok-image-other-home-",
      });
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-grok-image-other-workspace-",
      });
      const otherWorkspace = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-grok-image-other-cwd-",
      });
      const imagePath = yield* writeSessionImage({
        homeDir,
        workspaceRoot: otherWorkspace,
        sessionId: "session-1",
      });

      expect(
        yield* resolveGrokSessionImageFile({
          homeDir,
          workspaceRoot,
          requestedPath: imagePath,
        }),
      ).toBeNull();
      expect(
        yield* resolveGrokSessionImageFile({
          homeDir,
          workspaceRoot,
          requestedPath: "images/1.jpg",
        }),
      ).toBeNull();
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects relative path traversal", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const homeDir = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-grok-image-trav-home-",
      });
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-grok-image-trav-workspace-",
      });
      yield* writeSessionImage({
        homeDir,
        workspaceRoot,
        sessionId: "session-1",
      });

      expect(
        yield* resolveGrokSessionImageFile({
          homeDir,
          workspaceRoot,
          requestedPath: "../session-1/images/1.jpg",
        }),
      ).toBeNull();
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
