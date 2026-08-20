import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { resolveGeneratedProjectIconCandidates } from "./ProjectIconReactor.ts";

const resolveIconCandidates = (input: {
  readonly workspaceRoot: string;
  readonly outputPath: string;
  readonly reportedPath: string;
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return resolveGeneratedProjectIconCandidates({ path, ...input });
  }).pipe(Effect.provide(NodeServices.layer));

describe("resolveGeneratedProjectIconCandidates", () => {
  it.effect("lists the planned output first, then a workspace-contained reported path", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveIconCandidates({
        workspaceRoot: "/repo/project",
        outputPath: "/repo/project/.t3-generated-project-icon.png",
        reportedPath: "icons/generated.png",
      });
      expect(resolved).toEqual([
        "/repo/project/.t3-generated-project-icon.png",
        "/repo/project/icons/generated.png",
      ]);
    }),
  );

  it.effect("omits a model-reported image outside the workspace", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveIconCandidates({
        workspaceRoot: "/repo/project",
        outputPath: "/repo/project/.t3-generated-project-icon.png",
        reportedPath: "/etc/secret.png",
      });
      expect(resolved).toEqual(["/repo/project/.t3-generated-project-icon.png"]);
    }),
  );

  it.effect(
    "falls back to a workspace-contained reported path when the planned file is not an image",
    () =>
      Effect.gen(function* () {
        const resolved = yield* resolveIconCandidates({
          workspaceRoot: "/repo/project",
          outputPath: "/repo/project/.t3-generated-project-icon.txt",
          reportedPath: "icons/generated.png",
        });
        expect(resolved).toEqual(["/repo/project/icons/generated.png"]);
      }),
  );

  it.effect("rejects a model-reported image that escapes the workspace", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveIconCandidates({
        workspaceRoot: "/repo/project",
        outputPath: "/repo/project/.t3-generated-project-icon.txt",
        reportedPath: "/etc/secret.png",
      });
      expect(resolved).toEqual([]);
    }),
  );

  it.effect("rejects traversal out of the workspace", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveIconCandidates({
        workspaceRoot: "/repo/project",
        outputPath: "/repo/project/.t3-generated-project-icon.txt",
        reportedPath: "../other-project/icon.png",
      });
      expect(resolved).toEqual([]);
    }),
  );

  it.effect("rejects a sibling directory that shares the workspace path prefix", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveIconCandidates({
        workspaceRoot: "/repo/project",
        outputPath: "/repo/project/.t3-generated-project-icon.txt",
        reportedPath: "/repo/project-evil/icon.png",
      });
      expect(resolved).toEqual([]);
    }),
  );
});
