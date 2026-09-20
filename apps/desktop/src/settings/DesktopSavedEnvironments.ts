import { EnvironmentId, type PersistedSavedEnvironmentRecord } from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { readFileStringWithinLimit } from "../boundedFileRead.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";

export const SAVED_ENVIRONMENT_REGISTRY_FILE_MAX_BYTES = 16 * 1024 * 1024;

type PersistedSavedEnvironmentDesktopSsh = NonNullable<
  PersistedSavedEnvironmentRecord["desktopSsh"]
>;

interface PersistedSavedEnvironmentStorageRecord extends Omit<
  PersistedSavedEnvironmentRecord,
  "desktopSsh"
> {
  readonly desktopSsh?: PersistedSavedEnvironmentDesktopSsh;
  readonly encryptedBearerToken?: string;
}

interface SavedEnvironmentRegistryDocument {
  readonly version: number;
  readonly records: readonly PersistedSavedEnvironmentStorageRecord[];
}

interface SavedEnvironmentRegistryStorageDocument {
  readonly version?: number;
  readonly records?: readonly PersistedSavedEnvironmentStorageRecord[];
}

const DesktopSshTargetSchema = Schema.Struct({
  alias: Schema.String,
  hostname: Schema.String,
  username: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Number),
});

const PersistedSavedEnvironmentStorageRecordSchema = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  httpBaseUrl: Schema.String,
  wsBaseUrl: Schema.String,
  createdAt: Schema.String,
  lastConnectedAt: Schema.NullOr(Schema.String),
  desktopSsh: Schema.optionalKey(DesktopSshTargetSchema),
  relayManaged: Schema.optionalKey(Schema.Struct({ relayUrl: Schema.String })),
  encryptedBearerToken: Schema.optionalKey(Schema.String),
});

const SavedEnvironmentRegistryDocumentSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.Number),
  records: Schema.optionalKey(Schema.Array(PersistedSavedEnvironmentStorageRecordSchema)),
});

const SavedEnvironmentRegistryDocumentJson = fromLenientJson(
  SavedEnvironmentRegistryDocumentSchema,
);
const decodeSavedEnvironmentRegistryDocumentJson = Schema.decodeEffect(
  SavedEnvironmentRegistryDocumentJson,
);

const DesktopSavedEnvironmentSecretProtectionOperation = Schema.Literals([
  "check-encryption-availability",
  "decrypt-secret",
]);

export class DesktopSavedEnvironmentsReadError extends Schema.TaggedError<DesktopSavedEnvironmentsReadError>()(
  "DesktopSavedEnvironmentsReadError",
  {
    registryPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read desktop saved environments at ${this.registryPath}.`;
  }
}

export class DesktopSavedEnvironmentsDocumentDecodeError extends Schema.TaggedError<DesktopSavedEnvironmentsDocumentDecodeError>()(
  "DesktopSavedEnvironmentsDocumentDecodeError",
  {
    registryPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to decode desktop saved environments at ${this.registryPath}.`;
  }
}

export class DesktopSavedEnvironmentSecretDecodeError extends Schema.TaggedError<DesktopSavedEnvironmentSecretDecodeError>()(
  "DesktopSavedEnvironmentSecretDecodeError",
  {
    environmentId: Schema.String,
    registryPath: Schema.String,
    field: Schema.Literal("encryptedBearerToken"),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to decode ${this.field} for environment ${this.environmentId} at ${this.registryPath}.`;
  }
}

export class DesktopSavedEnvironmentSecretProtectionError extends Schema.TaggedError<DesktopSavedEnvironmentSecretProtectionError>()(
  "DesktopSavedEnvironmentSecretProtectionError",
  {
    operation: DesktopSavedEnvironmentSecretProtectionOperation,
    environmentId: Schema.String,
    registryPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Desktop saved-environment secret protection failed during ${this.operation} for environment ${this.environmentId} at ${this.registryPath}.`;
  }
}

export type DesktopSavedEnvironmentsReadRegistryError =
  | DesktopSavedEnvironmentsReadError
  | DesktopSavedEnvironmentsDocumentDecodeError;

export type DesktopSavedEnvironmentsGetSecretError =
  | DesktopSavedEnvironmentsReadRegistryError
  | DesktopSavedEnvironmentSecretDecodeError
  | DesktopSavedEnvironmentSecretProtectionError;

/** Reads the previous registry for connection-catalog migration. */
export class DesktopSavedEnvironments extends Context.Service<
  DesktopSavedEnvironments,
  {
    readonly getRegistry: Effect.Effect<
      readonly PersistedSavedEnvironmentRecord[],
      DesktopSavedEnvironmentsReadRegistryError
    >;

    readonly getSecret: (
      environmentId: string,
    ) => Effect.Effect<Option.Option<string>, DesktopSavedEnvironmentsGetSecretError>;
  }
>()("@t3tools/desktop/settings/DesktopSavedEnvironments") {}

function toPersistedSavedEnvironmentRecord(
  record: PersistedSavedEnvironmentStorageRecord,
): PersistedSavedEnvironmentRecord {
  const nextRecord = {
    environmentId: record.environmentId,
    label: record.label,
    httpBaseUrl: record.httpBaseUrl,
    wsBaseUrl: record.wsBaseUrl,
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
  };
  return {
    ...nextRecord,
    ...(record.desktopSsh ? { desktopSsh: record.desktopSsh } : {}),
    ...(record.relayManaged ? { relayManaged: record.relayManaged } : {}),
  };
}

function normalizeSavedEnvironmentRegistryDocument(
  document: SavedEnvironmentRegistryStorageDocument,
): SavedEnvironmentRegistryDocument {
  return {
    version: document.version ?? 1,
    records: document.records ?? [],
  };
}

function readRegistryDocument(
  fileSystem: FileSystem.FileSystem,
  registryPath: string,
): Effect.Effect<SavedEnvironmentRegistryDocument, DesktopSavedEnvironmentsReadRegistryError> {
  return readFileStringWithinLimit(
    fileSystem,
    registryPath,
    SAVED_ENVIRONMENT_REGISTRY_FILE_MAX_BYTES,
  ).pipe(
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed<string | null>(null)
          : Effect.fail(
              new DesktopSavedEnvironmentsReadError({
                registryPath,
                cause: error,
              }),
            ),
      DesktopFileSizeLimitExceededError: (error) =>
        Effect.fail(
          new DesktopSavedEnvironmentsReadError({
            registryPath,
            cause: error,
          }),
        ),
    }),
    Effect.flatMap((raw) =>
      raw === null
        ? Effect.succeed({ version: 1, records: [] })
        : decodeSavedEnvironmentRegistryDocumentJson(raw).pipe(
            Effect.map(normalizeSavedEnvironmentRegistryDocument),
            Effect.mapError(
              (cause) =>
                new DesktopSavedEnvironmentsDocumentDecodeError({
                  registryPath,
                  cause,
                }),
            ),
          ),
    ),
  );
}

function decodeSecretBytes(
  environmentId: string,
  registryPath: string,
  encoded: string,
): Effect.Effect<Uint8Array, DesktopSavedEnvironmentSecretDecodeError> {
  return Effect.fromResult(Encoding.decodeBase64(encoded)).pipe(
    Effect.mapError(
      (cause) =>
        new DesktopSavedEnvironmentSecretDecodeError({
          environmentId,
          registryPath,
          field: "encryptedBearerToken",
          cause,
        }),
    ),
  );
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;

  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;

  return DesktopSavedEnvironments.of({
    getRegistry: readRegistryDocument(fileSystem, environment.savedEnvironmentRegistryPath).pipe(
      Effect.map((document) =>
        document.records.map((record) => toPersistedSavedEnvironmentRecord(record)),
      ),
      Effect.withSpan("desktop.savedEnvironments.getRegistry"),
    ),
    setRegistry: Effect.fn("desktop.savedEnvironments.setRegistry")(function* (records) {
      yield* mutationSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const currentDocument = yield* readRegistryDocument(
            fileSystem,
            environment.savedEnvironmentRegistryPath,
          );
          yield* writeDocument(preserveExistingSecrets(currentDocument, records));
        }),
      );
    }),
    removeEnvironment: Effect.fn("desktop.savedEnvironments.removeEnvironment")(
      function* (environmentId) {
        yield* Effect.annotateCurrentSpan({ environmentId });
        yield* mutationSemaphore.withPermits(1)(
          Effect.gen(function* () {
            const document = yield* readRegistryDocument(
              fileSystem,
              environment.savedEnvironmentRegistryPath,
            );
            if (!document.records.some((record) => record.environmentId === environmentId)) {
              return;
            }

            yield* writeDocument({
              version: document.version,
              records: document.records.filter((record) => record.environmentId !== environmentId),
            });
          }),
        );
      },
    ),
    getSecret: Effect.fn("desktop.savedEnvironments.getSecret")(function* (environmentId) {
      yield* Effect.annotateCurrentSpan({ environmentId });
      const document = yield* readRegistryDocument(
        fileSystem,
        environment.savedEnvironmentRegistryPath,
      );
      const encoded = Option.fromNullishOr(
        document.records.find((record) => record.environmentId === environmentId)
          ?.encryptedBearerToken,
      );
      if (Option.isNone(encoded)) {
        return Option.none<string>();
      }
      const encryptionAvailable = yield* safeStorage.isEncryptionAvailable.pipe(
        Effect.mapError(
          (cause) =>
            new DesktopSavedEnvironmentSecretProtectionError({
              operation: "check-encryption-availability",
              environmentId,
              registryPath: environment.savedEnvironmentRegistryPath,
              cause,
            }),
        ),
      );
      if (!encryptionAvailable) {
        return Option.none<string>();
      }

      const secretBytes = yield* decodeSecretBytes(
        environmentId,
        environment.savedEnvironmentRegistryPath,
        encoded.value,
      );
      return Option.some(
        yield* safeStorage.decryptString(secretBytes).pipe(
          Effect.mapError(
            (cause) =>
              new DesktopSavedEnvironmentSecretProtectionError({
                operation: "decrypt-secret",
                environmentId,
                registryPath: environment.savedEnvironmentRegistryPath,
                cause,
              }),
          ),
        ),
      );
    }),
    setSecret: Effect.fn("desktop.savedEnvironments.setSecret")(function* (input) {
      const { environmentId, secret } = input;
      yield* Effect.annotateCurrentSpan({ environmentId });
      return yield* mutationSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const document = yield* readRegistryDocument(
            fileSystem,
            environment.savedEnvironmentRegistryPath,
          );

          const encryptionAvailable = yield* safeStorage.isEncryptionAvailable.pipe(
            Effect.mapError(
              (cause) =>
                new DesktopSavedEnvironmentSecretProtectionError({
                  operation: "check-encryption-availability",
                  environmentId,
                  registryPath: environment.savedEnvironmentRegistryPath,
                  cause,
                }),
            ),
          );
          if (!encryptionAvailable) {
            return false;
          }

          const encryptedBearerToken = Encoding.encodeBase64(
            yield* safeStorage.encryptString(secret).pipe(
              Effect.mapError(
                (cause) =>
                  new DesktopSavedEnvironmentSecretProtectionError({
                    operation: "encrypt-secret",
                    environmentId,
                    registryPath: environment.savedEnvironmentRegistryPath,
                    cause,
                  }),
              ),
            ),
          );
          let found = false;
          const nextDocument: SavedEnvironmentRegistryDocument = {
            version: document.version,
            records: document.records.map((record) => {
              if (record.environmentId !== environmentId) {
                return record;
              }

              found = true;
              return toSavedEnvironmentStorageRecord(record, Option.some(encryptedBearerToken));
            }),
          };

          if (found) {
            yield* writeDocument(nextDocument);
          }
          return found;
        }),
      );
    }),
    removeSecret: Effect.fn("desktop.savedEnvironments.removeSecret")(function* (environmentId) {
      yield* Effect.annotateCurrentSpan({ environmentId });
      yield* mutationSemaphore.withPermits(1)(
        Effect.gen(function* () {
          const document = yield* readRegistryDocument(
            fileSystem,
            environment.savedEnvironmentRegistryPath,
          );
          if (
            !document.records.some(
              (record) =>
                record.environmentId === environmentId && record.encryptedBearerToken !== undefined,
            )
          ) {
            return;
          }

          yield* writeDocument({
            version: document.version,
            records: document.records.map((record) => {
              if (record.environmentId !== environmentId) {
                return record;
              }
              return toPersistedSavedEnvironmentRecord(record);
            }),
          });
        }),
      );
    }),
  });
});

export const layer = Layer.effect(DesktopSavedEnvironments, make);
