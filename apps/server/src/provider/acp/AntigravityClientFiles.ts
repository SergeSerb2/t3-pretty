import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/compat";

/**
 * Workspace file access requested through the ACP client `fs` capability.
 * The agent gates each write behind `session/request_permission`, so only
 * path containment is checked here.
 */
const CLIENT_FILE_MAX_BYTES = 8 * 1024 * 1024;

function isInsideRoot(path: Path.Path, root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Resolves an agent-supplied path and rejects anything outside the session
 * roots. Symlinks resolve before the check, including the final component, so
 * a link inside the workspace cannot read or write through to a file outside
 * it. An entry that exists but cannot be resolved, like a dangling link, is
 * rejected rather than written through.
 */
const canonicalizeNearestExistingAncestor = Effect.fn(
  "AntigravityAdapter.canonicalizeNearestExistingAncestor",
)(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly candidate: string;
  readonly requestPath: string;
}) {
  const { fileSystem, path } = input;
  const unresolvedSegments: Array<string> = [];
  let ancestor = path.resolve(input.candidate);

  while (true) {
    const canonical = yield* fileSystem.realPath(ancestor).pipe(
      Effect.map(Option.some),
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : EffectAcpErrors.AcpRequestError.internalError(
                `Could not safely resolve '${input.requestPath}'.`,
              ),
      }),
    );
    if (Option.isSome(canonical)) {
      return path.join(canonical.value, ...unresolvedSegments);
    }

    // A broken symlink also reports NotFound from realPath. Fail closed rather
    // than rebuilding it lexically and allowing a later write through it.
    const unresolvedLink = yield* fileSystem.readLink(ancestor).pipe(
      Effect.map(Option.some),
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound"
            ? Effect.succeed(Option.none<string>())
            : EffectAcpErrors.AcpRequestError.internalError(
                `Could not safely resolve '${input.requestPath}'.`,
              ),
      }),
    );
    if (Option.isSome(unresolvedLink)) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `Path '${input.requestPath}' could not be safely resolved.`,
      );
    }

    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `Path '${input.requestPath}' could not be safely resolved.`,
      );
    }
    unresolvedSegments.unshift(path.basename(ancestor));
    ancestor = parent;
  }
});

/** Resolves an agent-supplied path and rejects anything outside the session roots. */
const resolveClientFilePath = Effect.fn("AntigravityClientFiles.resolveClientFilePath")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly allowedRoots: ReadonlyArray<string>;
    readonly requestPath: string;
  }) {
    const { path } = input;
    const resolved = path.resolve(input.requestPath);
    const outside = EffectAcpErrors.AcpRequestError.invalidParams(
      `Path '${input.requestPath}' is outside the session workspace.`,
    );
    const real = yield* canonicalizeNearestExistingAncestor({ ...input, candidate: resolved });
    const roots = yield* Effect.forEach(input.allowedRoots, (candidate) =>
      canonicalizeNearestExistingAncestor({ ...input, candidate }),
    );
    if (!roots.some((root) => isInsideRoot(path, root, real))) {
      return yield* outside;
    }
    return real;
  },
);

export const readAntigravityClientTextFile = Effect.fn("AntigravityClientFiles.readTextFile")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly allowedRoots: ReadonlyArray<string>;
    readonly request: EffectAcpSchema.ReadTextFileRequest;
  }): Effect.fn.Return<EffectAcpSchema.ReadTextFileResponse, EffectAcpErrors.AcpError> {
    const filePath = yield* resolveClientFilePath({ ...input, requestPath: input.request.path });
    const info = yield* input.fileSystem
      .stat(filePath)
      .pipe(
        Effect.mapError(() =>
          EffectAcpErrors.AcpRequestError.resourceNotFound(
            `File '${input.request.path}' not found.`,
          ),
        ),
      );
    if (info.type !== "File" || Number(info.size) > CLIENT_FILE_MAX_BYTES) {
      return yield* EffectAcpErrors.AcpRequestError.invalidParams(
        `File '${input.request.path}' is not a readable text file under ${CLIENT_FILE_MAX_BYTES} bytes.`,
      );
    }
    const text = yield* input.fileSystem
      .readFileString(filePath)
      .pipe(
        Effect.mapError(() =>
          EffectAcpErrors.AcpRequestError.internalError(`Could not read '${input.request.path}'.`),
        ),
      );
    const line = input.request.line ?? undefined;
    const limit = input.request.limit ?? undefined;
    if (line === undefined && limit === undefined) {
      return { content: text };
    }
    // ACP lines are 1-indexed. `limit` is a line count.
    const lines = text.split("\n");
    const start = Math.max(0, (line ?? 1) - 1);
    const end = limit === undefined ? lines.length : Math.min(lines.length, start + limit);
    return { content: lines.slice(start, end).join("\n") };
  },
);

export const writeAntigravityClientTextFile = Effect.fn("AntigravityClientFiles.writeTextFile")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly allowedRoots: ReadonlyArray<string>;
    readonly request: EffectAcpSchema.WriteTextFileRequest;
  }): Effect.fn.Return<EffectAcpSchema.WriteTextFileResponse, EffectAcpErrors.AcpError> {
    const filePath = yield* resolveClientFilePath({ ...input, requestPath: input.request.path });
    yield* input.fileSystem.makeDirectory(input.path.dirname(filePath), { recursive: true }).pipe(
      Effect.andThen(input.fileSystem.writeFileString(filePath, input.request.content)),
      Effect.mapError(() =>
        EffectAcpErrors.AcpRequestError.internalError(`Could not write '${input.request.path}'.`),
      ),
    );
    return {};
  },
);
