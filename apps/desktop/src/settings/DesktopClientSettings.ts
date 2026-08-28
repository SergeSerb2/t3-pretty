import { ClientSettingsSchema, type ClientSettings } from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Ref from "effect/Ref";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { readFileStringWithinLimit } from "../boundedFileRead.ts";

export const CLIENT_SETTINGS_FILE_MAX_BYTES = 1024 * 1024;

const ClientSettingsDocumentSchema = Schema.Struct({
  settings: ClientSettingsSchema,
});

const ClientSettingsJson = fromLenientJson(ClientSettingsSchema);
const LegacyClientSettingsDocumentJson = fromLenientJson(ClientSettingsDocumentSchema);
const decodeLegacyClientSettingsDocumentJson = Schema.decodeEffect(
  LegacyClientSettingsDocumentJson,
);
const decodeClientSettingsJsonValue = Schema.decodeEffect(ClientSettingsJson);
const decodeClientSettingsJson = (raw: string): Effect.Effect<ClientSettings, Schema.SchemaError> =>
  decodeLegacyClientSettingsDocumentJson(raw).pipe(
    Effect.map((document) => document.settings),
    Effect.catchTags({
      SchemaError: () => decodeClientSettingsJsonValue(raw),
    }),
  );
const encodeClientSettingsJson = Schema.encodeEffect(ClientSettingsJson);

const DesktopClientSettingsWriteOperation = Schema.Literals([
  "create-temporary-file-name",
  "encode-document",
  "create-directory",
  "write-temporary-file",
  "replace-settings-file",
]);

export class DesktopClientSettingsWriteError extends Schema.TaggedErrorClass<DesktopClientSettingsWriteError>()(
  "DesktopClientSettingsWriteError",
  {
    operation: DesktopClientSettingsWriteOperation,
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop client settings write failed during ${this.operation} at ${this.path}.`;
  }
}

export class DesktopClientSettingsReadError extends Schema.TaggedErrorClass<DesktopClientSettingsReadError>()(
  "DesktopClientSettingsReadError",
  {
    operation: Schema.Literals(["read-document", "decode-document"]),
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop client settings read failed during ${this.operation} at ${this.path}.`;
  }
}

export class DesktopClientSettings extends Context.Service<
  DesktopClientSettings,
  {
    readonly get: Effect.Effect<Option.Option<ClientSettings>, DesktopClientSettingsReadError>;
    readonly set: (
      settings: ClientSettings,
    ) => Effect.Effect<void, DesktopClientSettingsWriteError>;
  }
>()("@t3tools/desktop/settings/DesktopClientSettings") {}

const readClientSettings = (
  fileSystem: FileSystem.FileSystem,
  settingsPath: string,
): Effect.Effect<Option.Option<ClientSettings>, DesktopClientSettingsReadError> =>
  readFileStringWithinLimit(fileSystem, settingsPath, CLIENT_SETTINGS_FILE_MAX_BYTES).pipe(
    Effect.map(Option.some),
    Effect.catchTags({
      PlatformError: (cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed(Option.none<string>())
          : Effect.logWarning("Could not read desktop client settings.", cause).pipe(
              Effect.annotateLogs({ settingsPath }),
              Effect.andThen(
                new DesktopClientSettingsReadError({
                  operation: "read-document",
                  path: settingsPath,
                  cause,
                }),
              ),
            ),
      DesktopFileSizeLimitExceededError: (cause) =>
        Effect.logWarning("Desktop client settings exceed the supported size.", cause).pipe(
          Effect.annotateLogs({ settingsPath }),
          Effect.andThen(
            new DesktopClientSettingsReadError({
              operation: "read-document",
              path: settingsPath,
              cause,
            }),
          ),
        ),
    }),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(Option.none<ClientSettings>()),
        onSome: (raw) =>
          decodeClientSettingsJson(raw).pipe(
            Effect.map((settings) => Option.some(settings)),
            Effect.catchTags({
              SchemaError: (cause) =>
                Effect.logWarning("Could not decode desktop client settings.", cause).pipe(
                  Effect.annotateLogs({ settingsPath }),
                  Effect.andThen(
                    new DesktopClientSettingsReadError({
                      operation: "decode-document",
                      path: settingsPath,
                      cause,
                    }),
                  ),
                ),
            }),
          ),
      }),
    ),
  );

const writeClientSettings = Effect.fnUntraced(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly settingsPath: string;
  readonly settings: ClientSettings;
  readonly suffix: string;
}): Effect.fn.Return<void, DesktopClientSettingsWriteError> {
  const directory = input.path.dirname(input.settingsPath);
  const tempPath = `${input.settingsPath}.${process.pid}.${input.suffix}.tmp`;
  const encoded = yield* encodeClientSettingsJson(input.settings).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopClientSettingsWriteError({
          operation: "encode-document",
          path: input.settingsPath,
          cause,
        }),
    ),
  );
  const serialized = `${encoded}\n`;
  if (Buffer.byteLength(serialized, "utf8") > CLIENT_SETTINGS_FILE_MAX_BYTES) {
    return yield* new DesktopClientSettingsWriteError({
      operation: "encode-document",
      path: input.settingsPath,
      cause: new Error(`Encoded client settings exceed ${CLIENT_SETTINGS_FILE_MAX_BYTES} bytes.`),
    });
  }
  yield* input.fileSystem.makeDirectory(directory, { recursive: true }).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopClientSettingsWriteError({
          operation: "create-directory",
          path: directory,
          cause,
        }),
    ),
  );
  yield* Effect.gen(function* () {
    yield* input.fileSystem.writeFileString(tempPath, serialized).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopClientSettingsWriteError({
            operation: "write-temporary-file",
            path: tempPath,
            cause,
          }),
      ),
    );
    yield* input.fileSystem.rename(tempPath, input.settingsPath).pipe(
      Effect.mapError(
        (cause) =>
          new DesktopClientSettingsWriteError({
            operation: "replace-settings-file",
            path: input.settingsPath,
            cause,
          }),
      ),
    );
  }).pipe(Effect.ensuring(input.fileSystem.remove(tempPath, { force: true }).pipe(Effect.ignore)));
});

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const writeSemaphore = yield* Semaphore.make(1);

  return DesktopClientSettings.of({
    get: readClientSettings(fileSystem, environment.clientSettingsPath).pipe(
      Effect.withSpan("desktop.clientSettings.get"),
    ),
    set: (settings) =>
      writeSemaphore.withPermits(1)(
        crypto.randomUUIDv4.pipe(
          Effect.map((uuid) => uuid.replace(/-/g, "")),
          Effect.mapError(
            (cause) =>
              new DesktopClientSettingsWriteError({
                operation: "create-temporary-file-name",
                path: environment.clientSettingsPath,
                cause,
              }),
          ),
          Effect.flatMap((suffix) =>
            writeClientSettings({
              fileSystem,
              path,
              settingsPath: environment.clientSettingsPath,
              settings,
              suffix,
            }),
          ),
          Effect.withSpan("desktop.clientSettings.set"),
        ),
      ),
  });
});

export const layer = Layer.effect(DesktopClientSettings, make);

export const layerTest = (initialSettings: Option.Option<ClientSettings> = Option.none()) =>
  Layer.effect(
    DesktopClientSettings,
    Effect.gen(function* () {
      const settingsRef = yield* Ref.make(initialSettings);
      return DesktopClientSettings.of({
        get: Ref.get(settingsRef),
        set: (settings) => Ref.set(settingsRef, Option.some(settings)),
      });
    }),
  );
