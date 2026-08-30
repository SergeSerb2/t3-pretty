/**
 * T3ProjectFileLoader - Effect service that loads the checked-in `t3.json`
 * project file from a workspace root.
 *
 * Loading is best-effort: a missing file resolves to `Option.none`, and
 * unreadable or invalid files are logged and treated as absent so callers
 * can fall back to their defaults.
 *
 * @module T3ProjectFileLoader
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { T3_PROJECT_FILE_NAME, type T3ProjectFile } from "@t3tools/contracts";
import { T3ProjectFileFromJson } from "@t3tools/shared/t3ProjectFile";
import { readFilePrefix } from "../boundedFileRead.ts";

const decodeT3ProjectFileJson = Schema.decodeEffect(T3ProjectFileFromJson);
const T3_PROJECT_FILE_MAX_BYTES = 1024 * 1024;

export class T3ProjectFileLoadError extends Schema.TaggedErrorClass<T3ProjectFileLoadError>()(
  "T3ProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${T3_PROJECT_FILE_NAME} at ${this.filePath}.`;
  }
}

/** Service tag for t3.json project file loading. */
export class T3ProjectFileLoader extends Context.Service<
  T3ProjectFileLoader,
  {
    /**
     * Load and decode `t3.json` at the workspace root.
     *
     * Never fails: missing, unreadable, or invalid files resolve to
     * `Option.none` (invalid files are logged as warnings).
     */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<T3ProjectFile>>;
  }
>()("t3/project/T3ProjectFileLoader") {}

const logT3ProjectFileLoadError = (error: T3ProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: T3ProjectFileLoader["Service"]["load"] = Effect.fn("T3ProjectFileLoader.load")(
    function* (workspaceRoot) {
      const filePath = path.join(workspaceRoot, T3_PROJECT_FILE_NAME);
      const raw = yield* readFilePrefix(fileSystem, filePath, T3_PROJECT_FILE_MAX_BYTES + 1).pipe(
        Effect.map(Option.some),
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(Option.none<Uint8Array>())
              : logT3ProjectFileLoadError(
                  new T3ProjectFileLoadError({
                    operation: "read",
                    workspaceRoot,
                    filePath,
                    cause: error,
                  }),
                ).pipe(Effect.as(Option.none<Uint8Array>())),
        }),
      );
      if (Option.isNone(raw)) {
        return Option.none<T3ProjectFile>();
      }
      if (raw.value.byteLength > T3_PROJECT_FILE_MAX_BYTES) {
        return yield* logT3ProjectFileLoadError(
          new T3ProjectFileLoadError({
            operation: "read",
            workspaceRoot,
            filePath,
            cause: new Error(`${T3_PROJECT_FILE_NAME} exceeds ${T3_PROJECT_FILE_MAX_BYTES} bytes.`),
          }),
        ).pipe(Effect.as(Option.none<T3ProjectFile>()));
      }
      return yield* decodeT3ProjectFileJson(new TextDecoder().decode(raw.value)).pipe(
        Effect.map(Option.some),
        Effect.catchTags({
          SchemaError: (error) =>
            logT3ProjectFileLoadError(
              new T3ProjectFileLoadError({
                operation: "decode",
                workspaceRoot,
                filePath,
                cause: error,
              }),
            ).pipe(Effect.as(Option.none<T3ProjectFile>())),
        }),
      );
    },
  );

  return T3ProjectFileLoader.of({ load });
});

export const layer = Layer.effect(T3ProjectFileLoader, make);
