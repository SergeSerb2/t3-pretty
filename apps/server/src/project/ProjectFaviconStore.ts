// @effect-diagnostics nodeBuiltinImport:off
/**
 * Stores project icons picked from outside the workspace in T3 home.
 *
 * Bytes live under `project-icons/` keyed by project id and content revision
 * so the original file never has to be committed to the repo. The path saved
 * on the project record is a display-only managed marker, not a filesystem
 * path.
 *
 * @module ProjectFaviconStore
 */
import {
  PROJECT_IMPORT_FAVICON_MAX_BYTES,
  ProjectImportFaviconError,
  type ProjectImportFaviconResult,
} from "@t3tools/contracts";
import {
  MANAGED_PROJECT_FAVICON_REVISION_LENGTH,
  parseManagedProjectFaviconPath,
  toManagedProjectFaviconPath,
} from "@t3tools/shared/projectFavicon";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
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

function storedFileName(segment: string, revision: string, extension: string): string {
  return `${segment}.${revision}${extension}`;
}

const resolveStoredIconPath = Effect.fn("ProjectFaviconStore.resolveStoredIconPath")(function* (
  faviconPath: string,
  projectId: string,
) {
  const parsed = parseManagedProjectFaviconPath(faviconPath);
  const segment = toSafeProjectIconSegment(projectId);
  if (!parsed || !segment) {
    return null;
  }
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const iconsDir = yield* optionOnNotFound(fileSystem.realPath(config.projectIconsDir)).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
  );
  if (Option.isNone(iconsDir)) {
    return null;
  }
  const candidate = path.join(
    iconsDir.value,
    storedFileName(segment, parsed.revision, parsed.extension),
  );
  if (!isInsideDirectory(path, iconsDir.value, candidate)) {
    return null;
  }
  return { iconsDir: iconsDir.value, candidate, segment, parsed };
});

export const resolveManagedProjectFaviconFile = Effect.fn(
  "ProjectFaviconStore.resolveManagedProjectFaviconFile",
)(function* (input: { readonly projectId: string; readonly faviconPath: string }) {
  const resolved = yield* resolveStoredIconPath(input.faviconPath, input.projectId);
  if (!resolved) {
    return null;
  }
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const canonicalFile = yield* optionOnNotFound(fileSystem.realPath(resolved.candidate)).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
  );
  if (
    Option.isNone(canonicalFile) ||
    !isInsideDirectory(path, resolved.iconsDir, canonicalFile.value)
  ) {
    return null;
  }
  const info = yield* optionOnNotFound(fileSystem.stat(canonicalFile.value)).pipe(
    Effect.orElseSucceed(() => Option.none()),
  );
  return Option.isSome(info) && info.value.type === "File" ? canonicalFile.value : null;
});

export const removeManagedProjectFaviconFile = Effect.fn(
  "ProjectFaviconStore.removeManagedProjectFaviconFile",
)(function* (input: { readonly projectId: string; readonly faviconPath: string }) {
  const resolved = yield* resolveStoredIconPath(input.faviconPath, input.projectId);
  if (!resolved) {
    return;
  }
  const fileSystem = yield* FileSystem.FileSystem;
  yield* optionOnNotFound(fileSystem.remove(resolved.candidate)).pipe(
    Effect.orElseSucceed(() => Option.none()),
  );
});

export const importProjectFavicon = Effect.fn("ProjectFaviconStore.importProjectFavicon")(
  function* (input: {
    readonly projectId: string;
    readonly fileName: string;
    readonly dataUrl: string;
  }): Effect.fn.Return<
    ProjectImportFaviconResult & { readonly created: boolean },
    ProjectImportFaviconError,
    Crypto.Crypto | FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig
  > {
    const parsed = parseBase64DataUrl(input.dataUrl);
    if (!parsed) {
      return yield* new ProjectImportFaviconError({
        failure: "invalid_image",
        projectId: input.projectId,
        fileName: input.fileName,
      });
    }

    const bytes = Buffer.from(parsed.base64, "base64");
    if (bytes.byteLength === 0 || bytes.byteLength > PROJECT_IMPORT_FAVICON_MAX_BYTES) {
      return yield* new ProjectImportFaviconError({
        failure: "empty_or_too_large",
        projectId: input.projectId,
        fileName: input.fileName,
      });
    }

    const crypto = yield* Crypto.Crypto;
    const revision = yield* crypto.digest("SHA-256", bytes).pipe(
      Effect.map(Encoding.encodeHex),
      Effect.map((hex) => hex.slice(0, MANAGED_PROJECT_FAVICON_REVISION_LENGTH)),
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
    const faviconPath = toManagedProjectFaviconPath(input.fileName, revision);
    if (!faviconPath) {
      return yield* new ProjectImportFaviconError({
        failure: "invalid_image",
        projectId: input.projectId,
        fileName: input.fileName,
      });
    }

    const segment = toSafeProjectIconSegment(input.projectId);
    const managed = parseManagedProjectFaviconPath(faviconPath);
    if (!segment || !managed) {
      return yield* new ProjectImportFaviconError({
        failure: "write_failed",
        projectId: input.projectId,
        fileName: input.fileName,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const targetPath = path.join(
      config.projectIconsDir,
      storedFileName(segment, managed.revision, managed.extension),
    );
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
    const existed = yield* optionOnNotFound(fileSystem.stat(targetPath)).pipe(
      Effect.orElseSucceed(() => Option.none()),
    );
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

    return {
      faviconPath,
      created: Option.isNone(existed) || existed.value.type !== "File",
    };
  },
);
