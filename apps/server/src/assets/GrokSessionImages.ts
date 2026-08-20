/**
 * Grok Imagine writes generated images under
 * `~/.grok/sessions/<encodeURIComponent(cwd)>/<sessionId>/images/`, not the
 * workspace. Markdown then links `images/1.jpg` relative to the project root.
 * Asset URLs fall back here when the workspace copy is missing.
 *
 * The `%2F` sequences in session folder names are literal path segments.
 * Never URI-decode them.
 */
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

export interface ResolvedGrokSessionImage {
  readonly allowedRoot: string;
  readonly file: string;
}

export function grokSessionIdFromResumeCursor(cursor: unknown): string | undefined {
  if (cursor === null || typeof cursor !== "object") {
    return undefined;
  }
  const record = cursor as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.sessionId !== "string") {
    return undefined;
  }
  const sessionId = record.sessionId.trim();
  return sessionId.length > 0 ? sessionId : undefined;
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

function grokWorkspaceSessionKeys(workspaceRoot: string): ReadonlyArray<string> {
  const trimmed = workspaceRoot.replace(/[\\/]+$/u, "");
  const posix = trimmed.replaceAll("\\", "/");
  return [...new Set([workspaceRoot, trimmed, posix].map((value) => encodeURIComponent(value)))];
}

function isUnsafeRelativePath(relativePath: string, path: Path.Path): boolean {
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    return true;
  }
  return relativePath
    .split(/[\\/]/u)
    .some((segment) => segment === "" || segment === "." || segment === "..");
}

function hasSessionImagesPrefix(relativePath: string): boolean {
  return relativePath.replaceAll("\\", "/").startsWith("images/");
}

function isInsideRoot(root: string, candidate: string, path: Path.Path): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function mtimeMs(info: { readonly mtime: Option.Option<Date> }): number {
  return Option.isSome(info.mtime) ? info.mtime.value.getTime() : 0;
}

function isSafeSessionId(sessionId: string): boolean {
  return (
    sessionId.length > 0 &&
    !sessionId.includes("/") &&
    !sessionId.includes("\\") &&
    sessionId !== "." &&
    sessionId !== ".."
  );
}

export const resolveGrokSessionImageFile = Effect.fn("GrokSessionImages.resolve")(
  function* (input: {
    readonly homeDir: string;
    readonly requestedPath: string;
    readonly workspaceRoot: string;
    readonly grokSessionId?: string;
  }) {
    if (!isWorkspaceImagePreviewPath(input.requestedPath)) {
      return null;
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sessionRoots: string[] = [];
    for (const key of grokWorkspaceSessionKeys(input.workspaceRoot)) {
      const candidate = path.join(input.homeDir, ".grok", "sessions", key);
      const canonical = yield* optionOnNotFound(fileSystem.realPath(candidate));
      if (Option.isSome(canonical) && !sessionRoots.includes(canonical.value)) {
        sessionRoots.push(canonical.value);
      }
    }
    if (sessionRoots.length === 0) {
      return null;
    }

    const resolveExistingImage = Effect.fn("GrokSessionImages.resolveExistingImage")(function* (
      allowedRoot: string,
      candidatePath: string,
    ) {
      if (!isWorkspaceImagePreviewPath(candidatePath)) {
        return null;
      }
      const [canonicalRoot, canonicalFile] = yield* Effect.all([
        optionOnNotFound(fileSystem.realPath(allowedRoot)),
        optionOnNotFound(fileSystem.realPath(candidatePath)),
      ]);
      if (Option.isNone(canonicalRoot) || Option.isNone(canonicalFile)) {
        return null;
      }
      if (!isInsideRoot(canonicalRoot.value, canonicalFile.value, path)) {
        return null;
      }
      const info = yield* optionOnNotFound(fileSystem.stat(canonicalFile.value));
      if (Option.isNone(info) || info.value.type !== "File") {
        return null;
      }
      return {
        allowedRoot: canonicalRoot.value,
        file: canonicalFile.value,
      } satisfies ResolvedGrokSessionImage;
    });

    if (path.isAbsolute(input.requestedPath)) {
      for (const sessionRoot of sessionRoots) {
        const resolved = yield* resolveExistingImage(sessionRoot, input.requestedPath);
        if (resolved) {
          return resolved;
        }
      }
      return null;
    }

    if (isUnsafeRelativePath(input.requestedPath, path)) {
      return null;
    }
    if (!hasSessionImagesPrefix(input.requestedPath)) {
      return null;
    }

    const matches: Array<ResolvedGrokSessionImage & { readonly mtime: number }> = [];
    for (const sessionRoot of sessionRoots) {
      const sessionIds =
        input.grokSessionId !== undefined && isSafeSessionId(input.grokSessionId)
          ? [input.grokSessionId]
          : yield* optionOnNotFound(fileSystem.readDirectory(sessionRoot)).pipe(
              Effect.map((entries) => Option.getOrElse(entries, () => [] as string[])),
            );
      for (const sessionId of sessionIds) {
        if (!isSafeSessionId(sessionId) || sessionId.includes("\0")) {
          continue;
        }
        const candidatePath = path.join(sessionRoot, sessionId, input.requestedPath);
        const resolved = yield* resolveExistingImage(sessionRoot, candidatePath);
        if (!resolved) {
          continue;
        }
        if (input.grokSessionId !== undefined) {
          return resolved;
        }
        const info = yield* optionOnNotFound(fileSystem.stat(resolved.file));
        matches.push({
          ...resolved,
          mtime: Option.isSome(info) ? mtimeMs(info.value) : 0,
        });
      }
    }
    if (matches.length === 0) {
      return null;
    }
    matches.sort((left, right) => right.mtime - left.mtime);
    const newest = matches[0];
    return newest ? { allowedRoot: newest.allowedRoot, file: newest.file } : null;
  },
);
