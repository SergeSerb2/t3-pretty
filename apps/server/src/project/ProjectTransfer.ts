// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

import {
  CommandId,
  EventId,
  PROJECT_TRANSFER_MAX_ARCHIVE_BYTES,
  PROJECT_TRANSFER_UPLOAD_URL_TTL_MS,
  ProjectId,
  ProjectTransferError,
  ProjectTransferResult,
  ThreadId,
  type Project,
  OrchestrationV2ThreadProjectionJson,
  OrchestrationV2DomainEvent,
  type OrchestrationV2ThreadProjection,
  type ProjectTransferInspectInput,
  type ProjectTransferManifest,
  type ProjectTransferMode,
  type ProjectTransferPrepareInput,
  type ProjectTransferSendInput,
} from "@t3tools/contracts";
import * as ByteSize from "effect/ByteSize";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as HttpServerRequest from "effect/http/HttpServerRequest";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/http";
import type * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import {
  base64UrlDecodeUtf8,
  base64UrlEncode,
  signPayload,
  timingSafeEqualBase64Url,
} from "../auth/utils.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { EventSinkV2 } from "../orchestration-v2/EventSink.ts";
import { ProjectService } from "./ProjectService.ts";
import { ProjectionStoreV2 } from "../orchestration-v2/ProjectionStore.ts";
import {
  remapTransferredProjections,
  eventsForTransferredProjection,
} from "./ProjectTransferV2.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { releaseHttpClientResponseBody } from "../stream/releaseHttpClientResponseBody.ts";

export const PROJECT_TRANSFER_UPLOAD_ROUTE_PREFIX = "/api/project-transfers/upload";

const SIGNING_SECRET_NAME = "project-transfer-signing-key";
const TRANSFER_ARCHIVE_NAME = "workspace.tar.gz";
const ARCHIVE_EXCLUDES = [
  "node_modules",
  ".venv",
  "venv",
  "dist",
  "build",
  "target",
  ".next",
  ".turbo",
  ".cache",
  ".t3",
] as const;

const ProjectTransferUploadClaims = Schema.Struct({
  version: Schema.Literal(1),
  kind: Schema.Literal("project-transfer-upload"),
  transferId: Schema.String,
  expiresAt: Schema.Number,
});
type ProjectTransferUploadClaims = typeof ProjectTransferUploadClaims.Type;

const claimsJson = Schema.fromJsonString(ProjectTransferUploadClaims);
const decodeClaims = Schema.decodeUnknownOption(claimsJson);
const encodeClaims = Schema.encodeSync(claimsJson);

interface PendingTransfer {
  readonly manifest: ProjectTransferManifest;
  readonly stagingRoot: string;
  readonly destinationPath: string;
  readonly expiresAt: number;
}

const pendingTransfers = new Map<string, PendingTransfer>();
const isProjectTransferError = Schema.is(ProjectTransferError);

type ProjectTransferErrorReason =
  | "thread_not_found"
  | "thread_busy"
  | "thread_changed"
  | "workspace_not_found"
  | "destination_unavailable"
  | "archive_failed"
  | "archive_too_large"
  | "upload_failed";

const transferError = (reason: ProjectTransferErrorReason, detail: string) =>
  new ProjectTransferError({ reason, detail });

export function isManagedProjectWorkspace(workspaceRoot: string, projectsRoot: string): boolean {
  const resolvedRoot = NodePath.resolve(projectsRoot);
  const resolvedWorkspace = NodePath.resolve(workspaceRoot);
  const prefix = resolvedRoot.endsWith(NodePath.sep) ? resolvedRoot : resolvedRoot + NodePath.sep;
  return resolvedWorkspace.startsWith(prefix);
}

function transferMode(mode: ProjectTransferMode | undefined): ProjectTransferMode {
  return mode ?? "copy";
}

function stripThreadForTransfer(
  projection: OrchestrationV2ThreadProjection,
): OrchestrationV2ThreadProjectionJson {
  return {
    ...projection,
    messages: projection.messages.map((message) => ({
      ...message,
      attachments: [],
      streaming: false,
    })),
    turnItems: projection.turnItems.map((item) => ({
      ...item,
      ...("attachments" in item ? { attachments: [] } : {}),
    })),
    checkpoints: [],
    checkpointScopes: [],
  };
}

function countAttachments(projection: OrchestrationV2ThreadProjection): number {
  return projection.messages.reduce((count, message) => count + message.attachments.length, 0);
}

const runProcess = (input: ProcessRunner.ProcessRunInput) =>
  Effect.flatMap(ProcessRunner.ProcessRunner, (runner) => runner.run(input)).pipe(
    Effect.provide(ProcessRunner.layer),
  );

const loadSigningSecret = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  return yield* secrets.getOrCreateRandom(SIGNING_SECRET_NAME, 32);
});

function decodeUploadClaims(encoded: string): ProjectTransferUploadClaims | null {
  try {
    return Option.getOrNull(decodeClaims(base64UrlDecodeUtf8(encoded)));
  } catch {
    return null;
  }
}

function isBusy(projection: OrchestrationV2ThreadProjection): boolean {
  return (
    projection.runs.some((run) =>
      ["queued", "starting", "running", "waiting", "preparing"].includes(run.status),
    ) ||
    projection.providerSessions.some((session) =>
      ["starting", "running", "waiting"].includes(session.status),
    )
  );
}

export function manifestThreadIds(manifest: ProjectTransferManifest): ReadonlyArray<ThreadId> {
  return [
    manifest.thread.thread.id,
    ...(manifest.additionalThreads ?? []).map((projection) => projection.thread.id),
  ];
}

export function sameThreadIdSet(
  left: ReadonlyArray<ThreadId>,
  right: ReadonlyArray<ThreadId>,
): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== rightSet.size) return false;
  for (const id of leftSet) {
    if (!rightSet.has(id)) return false;
  }
  return true;
}

export function requireMoveSiblingThread(input: {
  readonly title: string;
  readonly detail: OrchestrationV2ThreadProjection | undefined;
  readonly shell:
    | {
        readonly pendingRuntimeRequest: { readonly kind: string } | null;
      }
    | undefined;
}): OrchestrationV2ThreadProjection | ProjectTransferError {
  if (input.detail === undefined) {
    return transferError(
      "workspace_not_found",
      `Could not load "${input.title}" to move this project. Try again once it is fully available.`,
    );
  }
  if (isBusy(input.detail)) {
    return transferError(
      "thread_busy",
      `Wait for "${input.detail.thread.title}" to finish before moving this project.`,
    );
  }
  if (input.shell === undefined) {
    return transferError(
      "workspace_not_found",
      `Could not load "${input.detail.thread.title}" to move this project. Try again once it is fully available.`,
    );
  }
  if (input.shell.pendingRuntimeRequest !== null) {
    return transferError(
      "thread_busy",
      `Resolve the pending approval or question on "${input.detail.thread.title}" before moving this project.`,
    );
  }
  return input.detail;
}

const inspectTransferSource = Effect.fn("ProjectTransfer.inspectSource")(function* (
  input: ProjectTransferInspectInput,
) {
  const snapshots = yield* ProjectionStoreV2;
  const projects = yield* ProjectService;
  const thread = Option.getOrUndefined(
    yield* snapshots.getThreadProjection(input.threadId).pipe(Effect.option),
  );
  if (!thread) {
    return yield* transferError("thread_not_found", "The source thread no longer exists.");
  }
  if (isBusy(thread)) {
    return yield* transferError(
      "thread_busy",
      "Wait for the current turn to finish before transferring this thread.",
    );
  }
  const threadShell = Option.getOrUndefined(
    yield* snapshots.getThreadShell(input.threadId).pipe(Effect.map(Option.fromNullishOr)),
  );
  if (threadShell?.pendingRuntimeRequest != null) {
    return yield* transferError(
      "thread_busy",
      "Resolve the pending approval or question before transferring this thread.",
    );
  }
  const projectShell = Option.getOrUndefined(yield* projects.getById(thread.thread.projectId));
  if (!projectShell) {
    return yield* transferError("thread_not_found", "The source project no longer exists.");
  }
  const workspaceRoot = thread.thread.worktreePath ?? projectShell.workspaceRoot;
  if (!workspaceRoot) {
    return yield* transferError(
      "workspace_not_found",
      "The source workspace could not be resolved.",
    );
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspaceStat = yield* fileSystem.stat(workspaceRoot).pipe(Effect.option);
  if (Option.isNone(workspaceStat) || workspaceStat.value.type !== "Directory") {
    return yield* transferError(
      "workspace_not_found",
      `The source workspace is not available at ${workspaceRoot}.`,
    );
  }
  const gitStat = yield* fileSystem.stat(path.join(workspaceRoot, ".git")).pipe(Effect.option);
  const includesGitMetadata = Option.isSome(gitStat) && gitStat.value.type === "Directory";
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const sourceEnvironmentId = yield* environment.getEnvironmentId;
  const project: Project = projectShell;
  const mode = transferMode(input.mode);
  const additionalThreads: OrchestrationV2ThreadProjectionJson[] = [];
  let skippedAttachmentCount = countAttachments(thread);
  if (mode === "move") {
    const [activeSnapshot, archiveSnapshot] = yield* Effect.all([
      snapshots.getShellSnapshot({ location: "active" }),
      snapshots.getShellSnapshot({ location: "archive" }),
    ]).pipe(
      Effect.mapError(() =>
        transferError("workspace_not_found", "Could not list other project threads."),
      ),
    );
    for (const sibling of [...activeSnapshot.threads, ...archiveSnapshot.archivedThreads]) {
      if (
        sibling.projectId !== thread.thread.projectId ||
        sibling.id === thread.thread.id ||
        sibling.deletedAt !== null
      ) {
        continue;
      }
      const siblingDetail = Option.getOrUndefined(
        yield* snapshots.getThreadProjection(sibling.id).pipe(Effect.option),
      );
      const siblingShell = Option.getOrUndefined(
        yield* snapshots.getThreadShell(sibling.id).pipe(Effect.map(Option.fromNullishOr)),
      );
      const resolved = requireMoveSiblingThread({
        title: sibling.title,
        detail: siblingDetail,
        shell: siblingShell,
      });
      if (isProjectTransferError(resolved)) {
        return yield* resolved;
      }
      skippedAttachmentCount += countAttachments(resolved);
      additionalThreads.push(stripThreadForTransfer(resolved));
    }
  }
  const manifest: ProjectTransferManifest = {
    version: 3,
    sourceEnvironmentId,
    project,
    thread: stripThreadForTransfer(thread),
    ...(additionalThreads.length > 0 ? { additionalThreads } : {}),
    includesGitMetadata,
    skippedAttachmentCount,
  };
  return { manifest, workspaceRoot };
});

export const inspectProjectTransfer = Effect.fn("ProjectTransfer.inspect")(function* (
  input: ProjectTransferInspectInput,
) {
  const inspected = yield* inspectTransferSource(input).pipe(
    Effect.mapError((cause) =>
      isProjectTransferError(cause)
        ? cause
        : transferError("workspace_not_found", "Could not inspect the source workspace."),
    ),
  );
  return { manifest: inspected.manifest };
});

function projectFolderName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80);
  return slug || "transferred-project";
}

const removeExpiredTransfers = Effect.fn("ProjectTransfer.removeExpired")(function* (now: number) {
  const fileSystem = yield* FileSystem.FileSystem;
  for (const [transferId, pending] of pendingTransfers) {
    if (pending.expiresAt > now) continue;
    pendingTransfers.delete(transferId);
    yield* fileSystem
      .remove(pending.stagingRoot, { recursive: true, force: true })
      .pipe(Effect.orElseSucceed(() => undefined));
  }
});

export const prepareProjectTransfer = Effect.fn("ProjectTransfer.prepare")(function* (
  input: ProjectTransferPrepareInput,
) {
  return yield* Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const now = yield* Clock.currentTimeMillis;
    yield* removeExpiredTransfers(now);
    const secret = yield* loadSigningSecret.pipe(
      Effect.mapError(() =>
        transferError("destination_unavailable", "The destination could not prepare the transfer."),
      ),
    );

    const projectsRoot = path.join(config.baseDir, "projects");
    yield* fileSystem.makeDirectory(projectsRoot, { recursive: true });
    const baseName = projectFolderName(input.manifest.project.title);
    let destinationPath = path.join(projectsRoot, baseName);
    for (
      let suffix = 2;
      (yield* fileSystem.exists(destinationPath)) ||
      [...pendingTransfers.values()].some((pending) => pending.destinationPath === destinationPath);
      suffix += 1
    ) {
      destinationPath = path.join(projectsRoot, `${baseName}-${suffix}`);
    }

    const transferId = NodeCrypto.randomUUID();
    const stagingRoot = path.join(config.stateDir, "project-transfers", transferId);
    yield* fileSystem.makeDirectory(stagingRoot, { recursive: true });
    const expiresAt = now + PROJECT_TRANSFER_UPLOAD_URL_TTL_MS;
    pendingTransfers.set(transferId, {
      manifest: input.manifest,
      stagingRoot,
      destinationPath,
      expiresAt,
    });
    const encoded = base64UrlEncode(
      encodeClaims({ version: 1, kind: "project-transfer-upload", transferId, expiresAt }),
    );
    return {
      transferId,
      relativeUrl: `${PROJECT_TRANSFER_UPLOAD_ROUTE_PREFIX}/${encoded}.${signPayload(encoded, secret)}`,
      destinationPath,
      expiresAt,
    };
  }).pipe(
    Effect.mapError((cause) =>
      isProjectTransferError(cause)
        ? cause
        : transferError(
            "destination_unavailable",
            "The destination could not prepare the transfer.",
          ),
    ),
  );
});

export const cancelProjectTransfer = Effect.fn("ProjectTransfer.cancel")(function* (input: {
  readonly transferId: string;
}) {
  const pending = pendingTransfers.get(input.transferId);
  pendingTransfers.delete(input.transferId);
  if (!pending) return { cancelled: false };
  const fileSystem = yield* FileSystem.FileSystem;
  yield* fileSystem
    .remove(pending.stagingRoot, { recursive: true, force: true })
    .pipe(Effect.orElseSucceed(() => undefined));
  return { cancelled: true };
});

export const validateProjectTransferUploadToken = Effect.fn("ProjectTransfer.validateUploadToken")(
  function* (token: string) {
    const [encoded, signature, extra] = token.split(".");
    if (!encoded || !signature || extra) return null;
    const secret = yield* loadSigningSecret.pipe(Effect.orElseSucceed(() => null));
    if (!secret || !timingSafeEqualBase64Url(signature, signPayload(encoded, secret))) return null;
    const claims = decodeUploadClaims(encoded);
    if (!claims || claims.expiresAt <= (yield* Clock.currentTimeMillis)) return null;
    return claims;
  },
);

const destinationModelSelection = Effect.fn("ProjectTransfer.destinationModel")(function* (
  source: OrchestrationV2ThreadProjectionJson["thread"]["modelSelection"],
) {
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const snapshots = yield* providers.getProviders;
  const matching = snapshots.find(
    (provider) =>
      provider.instanceId === source.instanceId &&
      provider.enabled &&
      provider.installed &&
      provider.availability !== "unavailable",
  );
  if (matching?.models.some((model) => model.slug === source.model)) return source;
  const fallback = snapshots.find(
    (provider) =>
      provider.enabled &&
      provider.installed &&
      provider.availability !== "unavailable" &&
      provider.models.length > 0,
  );
  const model = fallback?.models.find((candidate) => candidate.isDefault) ?? fallback?.models[0];
  return fallback && model ? { instanceId: fallback.instanceId, model: model.slug } : source;
});

export type ReceiveProjectTransferResult =
  | { readonly ok: true; readonly result: ProjectTransferResult }
  | { readonly ok: false; readonly status: number; readonly detail: string };

export const receiveProjectTransfer = Effect.fn("ProjectTransfer.receive")(function* (
  claims: ProjectTransferUploadClaims,
  body: HttpServerRequest.HttpServerRequest["stream"],
): Effect.fn.Return<
  ReceiveProjectTransferResult,
  never,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | ProviderRegistry.ProviderRegistry
  | EventSinkV2
  | ProjectService
> {
  const pending = pendingTransfers.get(claims.transferId);
  pendingTransfers.delete(claims.transferId);
  if (!pending || pending.expiresAt <= (yield* Clock.currentTimeMillis)) {
    return { ok: false, status: 404, detail: "Transfer expired." };
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projects = yield* ProjectService;
  const eventSink = yield* EventSinkV2;
  const archivePath = path.join(pending.stagingRoot, TRANSFER_ARCHIVE_NAME);
  const extractedPath = path.join(pending.stagingRoot, "workspace");
  let receivedBytes = 0;
  let destinationCreated = false;
  let importSucceeded = false;
  let createdProjectId: ProjectId | null = null;

  return yield* Effect.gen(function* () {
    yield* Stream.run(
      body.pipe(
        Stream.takeWhile((chunk) => {
          receivedBytes += chunk.byteLength;
          return receivedBytes <= PROJECT_TRANSFER_MAX_ARCHIVE_BYTES;
        }),
      ),
      fileSystem.sink(archivePath),
    );
    if (receivedBytes === 0 || receivedBytes > PROJECT_TRANSFER_MAX_ARCHIVE_BYTES) {
      return {
        ok: false,
        status: 413,
        detail: "The transfer archive is empty or too large.",
      } as const;
    }

    yield* fileSystem.makeDirectory(extractedPath, { recursive: true });
    const extracted = yield* runProcess({
      command: "tar",
      args: ["-xzf", archivePath, "-C", extractedPath],
      timeout: "30 minutes",
      maxOutputBytes: 64 * 1024,
      outputMode: "truncate",
    });
    if (extracted.code !== 0) {
      return {
        ok: false,
        status: 400,
        detail: "The project archive could not be extracted.",
      } as const;
    }
    if (yield* fileSystem.exists(pending.destinationPath)) {
      return {
        ok: false,
        status: 409,
        detail: "The destination folder is no longer available.",
      } as const;
    }
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        yield* fileSystem.rename(extractedPath, pending.destinationPath);
        destinationCreated = true;

        const projectId = ProjectId.make(NodeCrypto.randomUUID());
        const threadId = ThreadId.make(NodeCrypto.randomUUID());
        const importedAt = DateTime.formatIso(yield* DateTime.now);
        const defaultModelSelection = pending.manifest.project.defaultModelSelection
          ? yield* destinationModelSelection(pending.manifest.project.defaultModelSelection)
          : null;
        yield* projects.create({
          commandId: CommandId.make(NodeCrypto.randomUUID()),
          projectId,
          title: pending.manifest.project.title,
          workspaceRoot: pending.destinationPath,
          scripts: pending.manifest.project.scripts,
        });
        createdProjectId = projectId;
        const imported = remapTransferredProjections({
          projections: [pending.manifest.thread, ...(pending.manifest.additionalThreads ?? [])],
          projectId,
          firstThreadId: threadId,
          importedAt,
          workspaceRoot: pending.destinationPath,
          includesGitMetadata: pending.manifest.includesGitMetadata,
        });
        yield* projects.update({
          commandId: CommandId.make(NodeCrypto.randomUUID()),
          projectId,
          defaultModelSelection,
          defaultThreadEnvMode: pending.manifest.project.defaultThreadEnvMode,
          autoPull: pending.manifest.project.autoPull,
          projectIcon: pending.manifest.project.projectIcon,
        });
        const projections = yield* Effect.forEach(imported, (json) =>
          Effect.gen(function* () {
            const modelSelection = yield* destinationModelSelection(json.thread.modelSelection);
            return {
              ...json,
              thread: {
                ...json.thread,
                modelSelection,
                providerInstanceId: modelSelection.instanceId,
              },
            };
          }),
        );
        yield* eventSink
          .write({
            events: projections.flatMap(eventsForTransferredProjection),
          })
          .pipe(
            Effect.onError(() =>
              projects
                .delete({
                  commandId: CommandId.make(NodeCrypto.randomUUID()),
                  projectId,
                  force: true,
                })
                .pipe(Effect.orElseSucceed(() => undefined)),
            ),
          );
        importSucceeded = true;

        return {
          ok: true,
          result: { projectId, threadId, workspaceRoot: pending.destinationPath },
        } as const;
      }),
    );
  }).pipe(
    Effect.catch((cause) =>
      Effect.logError("Project transfer import failed.", { cause }).pipe(
        Effect.as({
          ok: false,
          status: 500,
          detail: "The destination could not import the project.",
        } as const),
      ),
    ),
    Effect.ensuring(
      Effect.all(
        [
          Effect.suspend(() =>
            createdProjectId !== null && !importSucceeded
              ? projects
                  .delete({
                    commandId: CommandId.make(NodeCrypto.randomUUID()),
                    projectId: createdProjectId,
                    force: true,
                  })
                  .pipe(Effect.orElseSucceed(() => undefined))
              : Effect.void,
          ),
          fileSystem.remove(pending.stagingRoot, { recursive: true, force: true }),
          Effect.suspend(() =>
            destinationCreated && !importSucceeded
              ? fileSystem.remove(pending.destinationPath, { recursive: true, force: true })
              : Effect.void,
          ),
        ],
        { concurrency: "unbounded", discard: true },
      ).pipe(Effect.orElseSucceed(() => undefined)),
    ),
  );
});

const removeTransferredSource = Effect.fn("ProjectTransfer.removeSource")(function* (inspected: {
  readonly manifest: ProjectTransferManifest;
  readonly workspaceRoot: string;
}) {
  const projects = yield* ProjectService;
  yield* projects.delete({
    commandId: CommandId.make(NodeCrypto.randomUUID()),
    projectId: inspected.manifest.project.id,
    force: true,
  });
  yield* Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const projectsRoot = path.join(config.baseDir, "projects");
    if (!isManagedProjectWorkspace(inspected.workspaceRoot, projectsRoot)) return;
    const projects = yield* ProjectService;
    const stillActive = yield* projects.getByWorkspaceRoot(inspected.workspaceRoot);
    if (Option.isSome(stillActive) && stillActive.value.id !== inspected.manifest.project.id) {
      return;
    }
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.remove(inspected.workspaceRoot, { recursive: true, force: true });
  }).pipe(
    Effect.catch(() =>
      Effect.logError("Transferred source workspace could not be deleted from disk."),
    ),
  );
});

function validDestinationUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const loopback =
      url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    return (url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
      url.pathname.startsWith(`${PROJECT_TRANSFER_UPLOAD_ROUTE_PREFIX}/`)
      ? url
      : null;
  } catch {
    return null;
  }
}

export const sendProjectTransfer = Effect.fn("ProjectTransfer.send")(function* (
  input: ProjectTransferSendInput,
) {
  return yield* Effect.gen(function* () {
    const destination = validDestinationUrl(input.destinationUrl);
    if (!destination) {
      return yield* transferError(
        "destination_unavailable",
        "The destination did not provide a valid secure transfer URL.",
      );
    }
    const mode = transferMode(input.mode);
    const inspected = yield* inspectTransferSource({
      threadId: input.threadId,
      mode,
    }).pipe(
      Effect.mapError((cause) =>
        isProjectTransferError(cause)
          ? cause
          : transferError("workspace_not_found", "Could not read the source workspace."),
      ),
    );
    if (
      DateTime.formatIso(inspected.manifest.thread.thread.updatedAt) !== input.expectedUpdatedAt
    ) {
      return yield* transferError(
        "thread_changed",
        "The thread changed after the transfer started. Review it and try again.",
      );
    }
    if (
      mode === "move" &&
      (input.expectedThreadIds === undefined ||
        !sameThreadIdSet(manifestThreadIds(inspected.manifest), input.expectedThreadIds))
    ) {
      return yield* transferError(
        "thread_changed",
        "The project threads changed after the transfer started. Review it and try again.",
      );
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const archiveRoot = path.join(config.stateDir, "project-transfers", "outgoing");
    const archivePath = path.join(archiveRoot, `${NodeCrypto.randomUUID()}.tar.gz`);
    yield* fileSystem.makeDirectory(archiveRoot, { recursive: true });

    return yield* Effect.gen(function* () {
      const archived = yield* runProcess({
        command: "tar",
        args: [
          "-czf",
          archivePath,
          ...ARCHIVE_EXCLUDES.map((entry) => `--exclude=${entry}`),
          ...(inspected.manifest.includesGitMetadata ? [] : ["--exclude=.git"]),
          "-C",
          inspected.workspaceRoot,
          ".",
        ],
        timeout: "30 minutes",
        maxOutputBytes: 64 * 1024,
        outputMode: "truncate",
      });
      if (archived.code !== 0) {
        return yield* transferError("archive_failed", "The source project could not be archived.");
      }
      const archive = yield* fileSystem.stat(archivePath);
      if (archive.size > ByteSize.bytes(PROJECT_TRANSFER_MAX_ARCHIVE_BYTES)) {
        return yield* transferError(
          "archive_too_large",
          "The compressed project is larger than the 96 MB transfer limit.",
        );
      }

      const response = yield* HttpClient.post(destination.toString(), {
        headers: { "content-length": String(archive.size) },
        body: HttpBody.stream(fileSystem.stream(archivePath), "application/gzip"),
      });
      if (response.status < 200 || response.status >= 300) {
        yield* releaseHttpClientResponseBody(response);
        return yield* transferError(
          "upload_failed",
          response.status === 404
            ? "The destination transfer expired. Start the transfer again."
            : `The destination rejected the transfer (${response.status}).`,
        );
      }
      const result = yield* HttpClientResponse.schemaBodyJson(ProjectTransferResult)(response).pipe(
        Effect.mapError(() =>
          transferError("upload_failed", "The destination returned an invalid transfer result."),
        ),
      );
      if (mode !== "move") return result;
      const latest = yield* inspectTransferSource({
        threadId: input.threadId,
        mode,
      }).pipe(Effect.option);
      if (
        Option.isNone(latest) ||
        input.expectedThreadIds === undefined ||
        !sameThreadIdSet(manifestThreadIds(latest.value.manifest), input.expectedThreadIds)
      ) {
        return { ...result, sourceRemoved: false };
      }
      const sourceRemoved = yield* removeTransferredSource(latest.value).pipe(
        Effect.as(true),
        Effect.catch(() =>
          Effect.logError(
            "Project transfer copied, but the source project could not be removed.",
          ).pipe(Effect.as(false)),
        ),
      );
      return { ...result, sourceRemoved };
    }).pipe(
      Effect.mapError((cause) =>
        isProjectTransferError(cause)
          ? cause
          : transferError("upload_failed", "The project could not be sent to the destination."),
      ),
      Effect.ensuring(
        fileSystem.remove(archivePath, { force: true }).pipe(Effect.orElseSucceed(() => undefined)),
      ),
    );
  }).pipe(
    Effect.mapError((cause) =>
      isProjectTransferError(cause)
        ? cause
        : transferError("upload_failed", "The project could not be sent to the destination."),
    ),
  );
});
