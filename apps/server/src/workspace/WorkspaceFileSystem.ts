// @effect-diagnostics nodeBuiltinImport:off
/**
 * WorkspaceFileSystem - Effect service contract for workspace file mutations.
 *
 * Owns workspace-root-relative file read/write operations and their associated
 * safety checks and cache invalidation hooks.
 *
 * @module WorkspaceFileSystem
 */
import * as NodeFSP from "node:fs/promises";

import type {
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "@t3tools/contracts";
import { PROJECT_FILE_CONTENTS_MAX_BYTES } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";

const PROJECT_READ_FILE_MAX_BYTES = PROJECT_FILE_CONTENTS_MAX_BYTES;

export class WorkspaceFileSystemOperationError extends Schema.TaggedErrorClass<WorkspaceFileSystemOperationError>()(
  "WorkspaceFileSystemOperationError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
    operationPath: Schema.String,
    operation: Schema.Literals([
      "realpath-workspace-root",
      "realpath-target",
      "open",
      "stat",
      "read",
      "close",
      "make-directory",
      "write-file",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Workspace file operation '${this.operation}' failed at '${this.operationPath}' for resolved path '${this.resolvedPath}' (requested as '${this.relativePath}' in '${this.workspaceRoot}').`;
  }
}

export class WorkspaceFilePathEscapeError extends Schema.TaggedErrorClass<WorkspaceFilePathEscapeError>()(
  "WorkspaceFilePathEscapeError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedWorkspaceRoot: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' resolves outside workspace root '${this.workspaceRoot}': ${this.resolvedPath}`;
  }
}

export class WorkspacePathNotFileError extends Schema.TaggedErrorClass<WorkspacePathNotFileError>()(
  "WorkspacePathNotFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace path '${this.relativePath}' in '${this.workspaceRoot}' is not a file: ${this.resolvedPath}`;
  }
}

export class WorkspaceBinaryFileError extends Schema.TaggedErrorClass<WorkspaceBinaryFileError>()(
  "WorkspaceBinaryFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' in '${this.workspaceRoot}' is binary and cannot be previewed as text.`;
  }
}

export class WorkspaceFileTooLargeError extends Schema.TaggedErrorClass<WorkspaceFileTooLargeError>()(
  "WorkspaceFileTooLargeError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
    actualBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    maximumBytes: Schema.Int.check(Schema.isGreaterThan(0)),
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' in '${this.workspaceRoot}' exceeds the ${this.maximumBytes}-byte save limit.`;
  }
}

export const WorkspaceFileSystemError = Schema.Union([
  WorkspaceFileSystemOperationError,
  WorkspaceFilePathEscapeError,
  WorkspacePathNotFileError,
  WorkspaceBinaryFileError,
  WorkspaceFileTooLargeError,
]);
export type WorkspaceFileSystemError = typeof WorkspaceFileSystemError.Type;

/** Service tag for workspace file operations. */
export class WorkspaceFileSystem extends Context.Service<
  WorkspaceFileSystem,
  {
    /** Read a UTF-8 text file relative to the workspace root. */
    readonly readFile: (
      input: ProjectReadFileInput,
    ) => Effect.Effect<
      ProjectReadFileResult,
      WorkspaceFileSystemError | WorkspacePaths.WorkspacePathOutsideRootError
    >;
    /**
     * Write a file relative to the workspace root.
     *
     * Creates parent directories as needed and rejects paths that escape the
     * workspace root.
     */
    readonly writeFile: (
      input: ProjectWriteFileInput,
    ) => Effect.Effect<
      ProjectWriteFileResult,
      WorkspaceFileSystemError | WorkspacePaths.WorkspacePathOutsideRootError
    >;
  }
>()("t3/workspace/WorkspaceFileSystem") {}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;

  const realpathForOperation = (input: {
    readonly workspaceRoot: string;
    readonly relativePath: string;
    readonly resolvedPath: string;
    readonly operationPath: string;
    readonly operation: "realpath-workspace-root" | "realpath-target";
  }) =>
    Effect.tryPromise({
      try: () => NodeFSP.realpath(input.operationPath),
      catch: (cause) => new WorkspaceFileSystemOperationError({ ...input, cause }),
    });

  const assertCanonicalWithinRoot = (input: {
    readonly workspaceRoot: string;
    readonly relativePath: string;
    readonly resolvedWorkspaceRoot: string;
    readonly resolvedPath: string;
  }) => {
    const relativeRealPath = path.relative(input.resolvedWorkspaceRoot, input.resolvedPath);
    return relativeRealPath.startsWith(`..${path.sep}`) ||
      relativeRealPath === ".." ||
      path.isAbsolute(relativeRealPath)
      ? Effect.fail(new WorkspaceFilePathEscapeError(input))
      : Effect.void;
  };

  const realpathNearestExistingAncestor = (input: {
    readonly workspaceRoot: string;
    readonly relativePath: string;
    readonly resolvedPath: string;
    readonly startPath: string;
  }) =>
    Effect.tryPromise({
      try: async () => {
        let candidate = input.startPath;
        while (true) {
          try {
            return await NodeFSP.realpath(candidate);
          } catch (cause) {
            if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
            const parent = path.dirname(candidate);
            if (parent === candidate) throw cause;
            candidate = parent;
          }
        }
      },
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.workspaceRoot,
          relativePath: input.relativePath,
          resolvedPath: input.resolvedPath,
          operationPath: input.startPath,
          operation: "realpath-target",
          cause,
        }),
    });

  const readFile: WorkspaceFileSystem["Service"]["readFile"] = Effect.fn(
    "WorkspaceFileSystem.readFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const realWorkspaceRoot = yield* realpathForOperation({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
      resolvedPath: target.absolutePath,
      operationPath: input.cwd,
      operation: "realpath-workspace-root",
    });
    const realTargetPath = yield* realpathForOperation({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
      resolvedPath: target.absolutePath,
      operationPath: target.absolutePath,
      operation: "realpath-target",
    });
    yield* assertCanonicalWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
      resolvedWorkspaceRoot: realWorkspaceRoot,
      resolvedPath: realTargetPath,
    });

    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => NodeFSP.open(realTargetPath, "r"),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: realTargetPath,
            operationPath: realTargetPath,
            operation: "open",
            cause,
          }),
      }),
      (handle) =>
        Effect.gen(function* () {
          const stat = yield* Effect.tryPromise({
            try: () => handle.stat(),
            catch: (cause) =>
              new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
                operationPath: realTargetPath,
                operation: "stat",
                cause,
              }),
          });
          if (!stat.isFile()) {
            return yield* new WorkspacePathNotFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
            });
          }

          const readAt = (buffer: Buffer, offset: number, length: number, position: number) =>
            Effect.tryPromise({
              try: () => handle.read(buffer, offset, length, position),
              catch: (cause) =>
                new WorkspaceFileSystemOperationError({
                  workspaceRoot: input.cwd,
                  relativePath: input.relativePath,
                  resolvedPath: realTargetPath,
                  operationPath: realTargetPath,
                  operation: "read",
                  cause,
                }),
            });

          const readLimit = PROJECT_READ_FILE_MAX_BYTES + 1;
          const chunks: Buffer[] = [];
          let totalBytesRead = 0;
          const readChunk = Effect.fn("WorkspaceFileSystem.readFile.readChunk")(function* (
            buffer: Buffer,
          ) {
            let offset = 0;
            while (offset < buffer.byteLength) {
              const result = yield* readAt(
                buffer,
                offset,
                buffer.byteLength - offset,
                totalBytesRead,
              );
              if (result.bytesRead === 0) break;
              offset += result.bytesRead;
              totalBytesRead += result.bytesRead;
            }
            if (offset > 0) {
              chunks.push(offset === buffer.byteLength ? buffer : buffer.subarray(0, offset));
            }
            return offset;
          });

          const initialBytesToRead = Math.min(stat.size, readLimit);
          if (initialBytesToRead > 0) {
            yield* readChunk(Buffer.alloc(initialBytesToRead));
          }

          if (totalBytesRead < readLimit) {
            const probeBytesRead = yield* readChunk(Buffer.alloc(1));
            if (probeBytesRead > 0 && totalBytesRead < readLimit) {
              yield* readChunk(Buffer.alloc(readLimit - totalBytesRead));
            }
          }

          const finalStat = yield* Effect.tryPromise({
            try: () => handle.stat(),
            catch: (cause) =>
              new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
                operationPath: realTargetPath,
                operation: "stat",
                cause,
              }),
          });
          const retainedByteLength = Math.min(
            totalBytesRead,
            finalStat.size,
            PROJECT_READ_FILE_MAX_BYTES,
          );
          const fileBytes =
            chunks.length === 1
              ? chunks[0]!.subarray(0, retainedByteLength)
              : Buffer.concat(chunks, totalBytesRead).subarray(0, retainedByteLength);
          if (fileBytes.includes(0)) {
            return yield* new WorkspaceBinaryFileError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
            });
          }

          return {
            relativePath: target.relativePath,
            contents: new TextDecoder("utf-8").decode(fileBytes),
            byteLength: finalStat.size,
            truncated:
              finalStat.size > PROJECT_READ_FILE_MAX_BYTES || finalStat.size > totalBytesRead,
          };
        }),
      (handle) =>
        Effect.tryPromise({
          try: () => handle.close(),
          catch: (cause) =>
            new WorkspaceFileSystemOperationError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
              operationPath: realTargetPath,
              operation: "close",
              cause,
            }),
        }),
    );
  });

  const writeFile: WorkspaceFileSystem["Service"]["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    const encodedContents = new TextEncoder().encode(input.contents);
    if (encodedContents.byteLength > PROJECT_FILE_CONTENTS_MAX_BYTES) {
      return yield* new WorkspaceFileTooLargeError({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
        resolvedPath: target.absolutePath,
        actualBytes: encodedContents.byteLength,
        maximumBytes: PROJECT_FILE_CONTENTS_MAX_BYTES,
      });
    }

    const realWorkspaceRoot = yield* realpathForOperation({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
      resolvedPath: target.absolutePath,
      operationPath: input.cwd,
      operation: "realpath-workspace-root",
    });
    const realExistingAncestor = yield* realpathNearestExistingAncestor({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
      resolvedPath: target.absolutePath,
      startPath: path.dirname(target.absolutePath),
    });
    yield* assertCanonicalWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
      resolvedWorkspaceRoot: realWorkspaceRoot,
      resolvedPath: realExistingAncestor,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: path.dirname(target.absolutePath),
            operation: "make-directory",
            cause,
          }),
      ),
    );
    const realParentPath = yield* realpathForOperation({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
      resolvedPath: target.absolutePath,
      operationPath: path.dirname(target.absolutePath),
      operation: "realpath-target",
    });
    yield* assertCanonicalWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
      resolvedWorkspaceRoot: realWorkspaceRoot,
      resolvedPath: realParentPath,
    });

    const targetInfo = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await NodeFSP.lstat(target.absolutePath);
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw cause;
        }
      },
      catch: (cause) =>
        new WorkspaceFileSystemOperationError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: target.absolutePath,
          operationPath: target.absolutePath,
          operation: "stat",
          cause,
        }),
    });
    const writePath =
      targetInfo === null
        ? target.absolutePath
        : yield* realpathForOperation({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: target.absolutePath,
            operation: "realpath-target",
          });
    yield* assertCanonicalWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
      resolvedWorkspaceRoot: realWorkspaceRoot,
      resolvedPath: writePath,
    });

    yield* fileSystem.writeFileString(writePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: writePath,
            operation: "write-file",
            cause,
          }),
      ),
    );
    yield* workspaceEntries.refresh(input.cwd);
    return { relativePath: target.relativePath };
  });

  return WorkspaceFileSystem.of({ readFile, writeFile });
});

export const layer = Layer.effect(WorkspaceFileSystem, make);
