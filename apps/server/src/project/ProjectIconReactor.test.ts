import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { resolveGeneratedProjectIconPath } from "./ProjectIconReactor.ts";

const resolveIconPath = (input: {
  readonly workspaceRoot: string;
  readonly outputPath: string;
  readonly reportedPath: string;
}) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    return resolveGeneratedProjectIconPath({ path, ...input });
  }).pipe(Effect.provide(NodeServices.layer));

describe("resolveGeneratedProjectIconPath", () => {
  it.effect("prefers the known output path over a model-reported image outside the workspace", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveIconPath({
        workspaceRoot: "/repo/project",
        outputPath: "/repo/project/.t3-generated-project-icon.png",
        reportedPath: "/etc/secret.png",
      });
      expect(resolved).toBe("/repo/project/.t3-generated-project-icon.png");
    }),
  );

  it.effect("accepts a model-reported path only when it resolves inside the workspace", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveIconPath({
        workspaceRoot: "/repo/project",
        outputPath: "/repo/project/.t3-generated-project-icon.txt",
        reportedPath: "icons/generated.png",
      });
      expect(resolved).toBe("/repo/project/icons/generated.png");
    }),
  );

  it.effect("rejects a model-reported image that escapes the workspace", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveIconPath({
        workspaceRoot: "/repo/project",
        outputPath: "/repo/project/.t3-generated-project-icon.txt",
        reportedPath: "/etc/secret.png",
      });
      expect(resolved).toBeNull();
    }),
  );

  it.effect("rejects traversal out of the workspace", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveIconPath({
        workspaceRoot: "/repo/project",
        outputPath: "/repo/project/.t3-generated-project-icon.txt",
        reportedPath: "../other-project/icon.png",
      });
      expect(resolved).toBeNull();
    }),
  );

  it.effect("rejects a sibling directory that shares the workspace path prefix", () =>
    Effect.gen(function* () {
      const resolved = yield* resolveIconPath({
        workspaceRoot: "/repo/project",
        outputPath: "/repo/project/.t3-generated-project-icon.txt",
        reportedPath: "/repo/project-evil/icon.png",
      });
      expect(resolved).toBeNull();
    }),
  );
});
