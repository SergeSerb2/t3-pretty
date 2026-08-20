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
  if (typeof record.sessionId !== "string") {
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

function grokWorkspaceSessionKeys(workspaceRoots: ReadonlyArray<string>): ReadonlyArray<string> {
  const variants: string[] = [];
  for (const workspaceRoot of workspaceRoots) {
    const trimmed = workspaceRoot.replace(/[\\/]+$/u, "");
    const posix = trimmed.replaceAll("\\", "/");
    variants.push(workspaceRoot, trimmed, posix);
  }
  return [
    ...new Set(
      variants.filter((value) => value.length > 0).map((value) => encodeURIComponent(value)),
    ),
  ];
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

function sessionImagesDirectory(
  sessionRoot: string,
  filePath: string,
  path: Path.Path,
): string | null {
  const relative = path.relative(sessionRoot, filePath).replaceAll("\\", "/");
  if (relative === "" || relative.startsWith("../") || path.isAbsolute(relative)) {
    return null;
  }
  const slash = relative.indexOf("/");
  if (slash <= 0) {
    return null;
  }
  const rest = relative.slice(slash + 1);
  if (!hasSessionImagesPrefix(rest)) {
    return null;
  }
  return path.dirname(filePath);
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
    readonly extraWorkspaceRoots?: ReadonlyArray<string>;
    readonly grokSessionId?: string;
    readonly homeDir: string;
    readonly requestedPath: string;
    readonly workspaceRoot: string;
  }) {
    if (!isWorkspaceImagePreviewPath(input.requestedPath)) {
      return null;
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const workspaceRoots = [input.workspaceRoot, ...(input.extraWorkspaceRoots ?? [])];
    const resolvedWorkspaceRoots = [...workspaceRoots];
    for (const workspaceRoot of workspaceRoots) {
      const canonicalWorkspace = yield* optionOnNotFound(fileSystem.realPath(workspaceRoot));
      if (Option.isSome(canonicalWorkspace)) {
        resolvedWorkspaceRoots.push(canonicalWorkspace.value);
      }
    }
    const sessionRoots: string[] = [];
    for (const key of grokWorkspaceSessionKeys(resolvedWorkspaceRoots)) {
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
      sessionRoot: string,
      candidatePath: string,
    ) {
      if (!isWorkspaceImagePreviewPath(candidatePath)) {
        return null;
      }
      const [canonicalRoot, canonicalFile] = yield* Effect.all([
        optionOnNotFound(fileSystem.realPath(sessionRoot)),
        optionOnNotFound(fileSystem.realPath(candidatePath)),
      ]);
      if (Option.isNone(canonicalRoot) || Option.isNone(canonicalFile)) {
        return null;
      }
      if (!isInsideRoot(canonicalRoot.value, canonicalFile.value, path)) {
        return null;
      }
      const allowedRoot = sessionImagesDirectory(canonicalRoot.value, canonicalFile.value, path);
      if (allowedRoot === null) {
        return null;
      }
      const info = yield* optionOnNotFound(fileSystem.stat(canonicalFile.value));
      if (Option.isNone(info) || info.value.type !== "File") {
        return null;
      }
      return {
        allowedRoot,
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

    if (
      isUnsafeRelativePath(input.requestedPath, path) ||
      !hasSessionImagesPrefix(input.requestedPath)
    ) {
      return null;
    }
    if (input.grokSessionId === undefined || !isSafeSessionId(input.grokSessionId)) {
      return null;
    }

    for (const sessionRoot of sessionRoots) {
      const candidatePath = path.join(sessionRoot, input.grokSessionId, input.requestedPath);
      const resolved = yield* resolveExistingImage(sessionRoot, candidatePath);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  },
);
