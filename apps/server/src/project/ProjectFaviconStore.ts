// @effect-diagnostics nodeBuiltinImport:off
/**
 * Stores project icons picked from outside the workspace in T3 home.
 *
 * Bytes live under `project-icons/` keyed by project id so the original file
 * never has to be committed to the repo. The path saved on the project record
 * is a display-only managed marker, not a filesystem path.
 *
 * @module ProjectFaviconStore
 */
import {
  PROJECT_IMPORT_FAVICON_MAX_BYTES,
  ProjectImportFaviconError,
  type ProjectImportFaviconResult,
} from "@t3tools/contracts";
import { WORKSPACE_IMAGE_PREVIEW_EXTENSIONS } from "@t3tools/shared/filePreview";
import {
  isManagedProjectFaviconPath,
  toManagedProjectFaviconPath,
} from "@t3tools/shared/projectFavicon";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { parseBase64DataUrl } from "../imageMime.ts";
import * as ServerConfig from "../config.ts";

const PROJECT_ICON_ID_MAX_CHARS = 80;

export function toSafeProjectIconSegment(projectId: string): string | null {
  const segment = projectId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, PROJECT_ICON_ID_MAX_CHARS)
    .replace(/[-_]+$/g, "");
  return segment.length > 0 ? segment : null;
}

const optionOnNotFound = <A, R>(
  effect: Effect.Effect<A, PlatformError.PlatformError, R>,
): Effect.Effect<Option.Option<A>, PlatformError.PlatformError, R> =>
  effect.pipe(
    Effect.map(Option.some),
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound" ? Effect.succeed(Option.none<A>()) : Effect.fail(error),
    }),
  );

function isInsideDirectory(path: Path.Path, directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export const resolveManagedProjectFaviconFile = Effect.fn(
  "ProjectFaviconStore.resolveManagedProjectFaviconFile",
)(function* (input: { readonly projectId: string; readonly faviconPath: string }) {
  if (!isManagedProjectFaviconPath(input.faviconPath)) {
    return null;
  }
  const segment = toSafeProjectIconSegment(input.projectId);
  if (!segment) {
    return null;
  }
  const path = yield* Path.Path;
  const extension = path.extname(input.faviconPath).toLowerCase();
  if (
    !WORKSPACE_IMAGE_PREVIEW_EXTENSIONS.includes(
      extension as (typeof WORKSPACE_IMAGE_PREVIEW_EXTENSIONS)[number],
    )
  ) {
    return null;
  }
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const iconsDir = yield* optionOnNotFound(fileSystem.realPath(config.projectIconsDir)).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
  );
  if (Option.isNone(iconsDir)) {
    return null;
  }
  const candidate = path.join(iconsDir.value, `${segment}${extension}`);
  if (!isInsideDirectory(path, iconsDir.value, candidate)) {
    return null;
  }
  const canonicalFile = yield* optionOnNotFound(fileSystem.realPath(candidate)).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
  );
  if (
    Option.isNone(canonicalFile) ||
    !isInsideDirectory(path, iconsDir.value, canonicalFile.value)
  ) {
    return null;
  }
  const info = yield* optionOnNotFound(fileSystem.stat(canonicalFile.value)).pipe(
    Effect.orElseSucceed(() => Option.none()),
  );
  return Option.isSome(info) && info.value.type === "File" ? canonicalFile.value : null;
});

export const importProjectFavicon = Effect.fn("ProjectFaviconStore.importProjectFavicon")(
  function* (input: {
    readonly projectId: string;
    readonly fileName: string;
    readonly dataUrl: string;
  }): Effect.fn.Return<
    ProjectImportFaviconResult,
    ProjectImportFaviconError,
    FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig
  > {
    const faviconPath = toManagedProjectFaviconPath(input.fileName);
    if (!faviconPath) {
      return yield* new ProjectImportFaviconError({
        failure: "invalid_image",
        projectId: input.projectId,
        fileName: input.fileName,
      });
    }

    const parsed = parseBase64DataUrl(input.dataUrl);
    if (!parsed) {
      return yield* new ProjectImportFaviconError({
        failure: "invalid_image",
        projectId: input.projectId,
        fileName: input.fileName,
      });
    }
    const path = yield* Path.Path;
    const extension = path.extname(faviconPath).toLowerCase();

    const bytes = Buffer.from(parsed.base64, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > PROJECT_IMPORT_FAVICON_MAX_BYTES) {
      return yield* new ProjectImportFaviconError({
        failure: "empty_or_too_large",
        projectId: input.projectId,
        fileName: input.fileName,
      });
    }

    const segment = toSafeProjectIconSegment(input.projectId);
    if (!segment) {
      return yield* new ProjectImportFaviconError({
        failure: "write_failed",
        projectId: input.projectId,
        fileName: input.fileName,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    const targetPath = path.join(config.projectIconsDir, `${segment}${extension}`);
    if (!isInsideDirectory(path, config.projectIconsDir, targetPath)) {
      return yield* new ProjectImportFaviconError({
        failure: "write_failed",
        projectId: input.projectId,
        fileName: input.fileName,
      });
    }

    yield* fileSystem.makeDirectory(config.projectIconsDir, { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectImportFaviconError({
            failure: "write_failed",
            projectId: input.projectId,
            fileName: input.fileName,
            cause,
          }),
      ),
    );

    for (const staleExtension of WORKSPACE_IMAGE_PREVIEW_EXTENSIONS) {
      if (staleExtension === extension) continue;
      const stalePath = path.join(config.projectIconsDir, `${segment}${staleExtension}`);
      yield* optionOnNotFound(fileSystem.remove(stalePath)).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectImportFaviconError({
              failure: "write_failed",
              projectId: input.projectId,
              fileName: input.fileName,
              cause,
            }),
        ),
      );
    }

    yield* fileSystem.writeFile(targetPath, bytes).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectImportFaviconError({
            failure: "write_failed",
            projectId: input.projectId,
            fileName: input.fileName,
            cause,
          }),
      ),
    );

    return { faviconPath };
  },
);
