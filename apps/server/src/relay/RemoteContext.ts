// @effect-diagnostics nodeBuiltinImport:off -- Hash exact wire bytes and decode bounded file payloads on the Node server.
import * as NodeCrypto from "node:crypto";
import {
  CommandId,
  MessageId,
  OrchestratorMcpFailure,
  REMOTE_CONTEXT_MAX_FILE_BYTES,
  REMOTE_CONTEXT_MAX_TOTAL_BYTES,
  REMOTE_CONTEXT_MAX_BODY_BYTES,
  REMOTE_CONTEXT_PROOF_TYP,
  REMOTE_CONTEXT_ROUTE,
  RemoteContextProof,
  RemoteContextRequest,
  RemoteContextResult,
  type ChatAttachment,
  type EnvironmentId,
  type RemoteContextPeers,
  RemoteContextSendInput,
} from "@t3tools/contracts";
import { normalizeRelayIssuer, verifyRelayJwt } from "@t3tools/shared/relayJwt";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import * as Secrets from "../auth/ServerSecretStore.ts";
import { CLOUD_LINKED_USER_ID, CLOUD_MINT_PUBLIC_KEY } from "../cloud/config.ts";
import * as Config from "../config.ts";
import { openMediaFile, statMediaFile } from "../assets/MediaFile.ts";
import { readFilePrefix } from "../boundedFileRead.ts";
import * as Environment from "../environment/ServerEnvironment.ts";
import * as McpContext from "../mcp/McpInvocationContext.ts";
import {
  assertLiveCaller,
  assertTargetWithinLimits,
  readCaller,
  unavailable,
} from "../mcp/threadAccess.ts";
import {
  attachmentFileExtension,
  createDeterministicAttachmentId,
  resolveAttachmentPath,
} from "../attachmentStore.ts";
import { DispatchModeLimit } from "../orchestration-v2/DispatchModeLimit.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Intake from "../orchestration-v2/ThreadMessageIntake.ts";
import * as Projects from "../project/ProjectService.ts";
import {
  makeRelayEnvironmentClient,
  readRelayEnvironmentConfig,
} from "./relayEnvironmentClient.ts";

const invalid = () =>
  new OrchestratorMcpFailure({
    code: "invalid_request",
    message: "The remote context request is invalid or exceeds its file limit.",
  });
const denied = () =>
  new OrchestratorMcpFailure({
    code: "capability_denied",
    message: "Connect did not authorize this remote context request.",
  });
const relayFailure = (error: { readonly _tag: string }) =>
  error._tag === "RelayAuthInvalidError" ? denied() : unavailable();
const encodeRequest = Schema.encodeEffect(Schema.fromJsonString(RemoteContextRequest));
const decodeSendInput = Schema.decodeUnknownEffect(RemoteContextSendInput);
const decodeRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(RemoteContextRequest));
const decodeProof = Schema.decodeUnknownEffect(RemoteContextProof);
const decodeResult = Schema.decodeUnknownEffect(Schema.fromJsonString(RemoteContextResult));
const decodeRemoteFailure = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OrchestratorMcpFailure),
);
const encodeString = Schema.encodeEffect(Schema.fromJsonString(Schema.String));
const encodeRequestKey = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(Schema.String)));
const digest = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");

/** Do not copy credentials, T3 state, dependency caches, or repository metadata. */
function shareablePath(path: string) {
  return !path
    .split(/[\\/]/)
    .some((part) =>
      /^(?:\.env(?:\..*)?|\.envrc|\.npmrc|\.netrc|\.git-credentials|\.git|\.t3|\.ssh|\.aws|\.gnupg|\.kube|\.docker|node_modules|credentials(?:\..*)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx))$/i.test(
        part,
      ),
    );
}

export class RemoteContext extends Context.Service<
  RemoteContext,
  {
    readonly peers: (
      scope: McpContext.McpInvocationScope,
    ) => Effect.Effect<RemoteContextPeers, OrchestratorMcpFailure>;
    readonly search: (
      scope: McpContext.McpInvocationScope,
      input: { environmentId: EnvironmentId; query: string },
    ) => Effect.Effect<RemoteContextResult, OrchestratorMcpFailure>;
    readonly send: (
      scope: McpContext.McpInvocationScope,
      input: RemoteContextSendInput,
    ) => Effect.Effect<RemoteContextResult, OrchestratorMcpFailure>;
    readonly receive: (
      proof: string,
      body: string,
    ) => Effect.Effect<RemoteContextResult, OrchestratorMcpFailure>;
  }
>()("t3/relay/RemoteContext") {}

const make = Effect.gen(function* () {
  const secrets = yield* Secrets.ServerSecretStore;
  const environment = yield* Environment.ServerEnvironment;
  const threads = yield* Threads.ThreadManagementService;
  const projects = yield* Projects.ProjectService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* Config.ServerConfig;
  const http = yield* HttpClient.HttpClient;
  // A failed publisher must not remove files that a concurrent retry is using.
  const publicationLock = yield* Semaphore.make(1);

  const caller = (scope: McpContext.McpInvocationScope) =>
    Effect.gen(function* () {
      yield* McpContext.requireThreadScope(scope, "Remote context");
      if (scope.environmentId !== (yield* environment.getEnvironmentId)) return yield* denied();
      return yield* readCaller().pipe(
        Effect.provideService(McpContext.McpInvocationContext, scope),
        Effect.provideService(Threads.ThreadManagementService, threads),
      );
    });
  const connection = Effect.gen(function* () {
    const relay = yield* readRelayEnvironmentConfig(secrets).pipe(Effect.mapError(unavailable));
    if (relay === null) return yield* denied();
    return {
      relay,
      client: yield* makeRelayEnvironmentClient(relay).pipe(Effect.mapError(unavailable)),
    };
  });
  const request = Effect.fn("RemoteContext.request")(
    function* (
      scope: McpContext.McpInvocationScope,
      environmentId: EnvironmentId,
      payload: RemoteContextRequest,
    ) {
      const context = yield* caller(scope);
      const body = yield* encodeRequest(payload).pipe(Effect.mapError(invalid));
      const { client } = yield* connection;
      const ticket = yield* client.peers
        .authorize({
          payload: {
            environmentId,
            sourceThreadId: context.caller!.id,
            digest: digest(body),
            ...context.limits,
          },
        })
        .pipe(Effect.mapError(relayFailure));
      if (payload.action === "send") {
        const current = yield* caller(scope);
        yield* assertLiveCaller(current);
        // The issued proof's ceiling must still fit within the current caller's modes.
        yield* assertTargetWithinLimits(current.limits, context.limits);
      }
      // Never follow redirects with a proof. It authorizes this body at one destination only.
      const response = yield* http
        .execute(
          HttpClientRequest.post(new URL(REMOTE_CONTEXT_ROUTE, ticket.httpBaseUrl).href).pipe(
            HttpClientRequest.setHeader("authorization", `Bearer ${ticket.proof}`),
            HttpClientRequest.bodyText(body, "application/json"),
          ),
        )
        .pipe(
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
          Effect.mapError(unavailable),
        );
      let bytes = 0;
      const chunks = yield* response.stream.pipe(
        Stream.mapError(unavailable),
        Stream.mapEffect((chunk) => {
          bytes += chunk.byteLength;
          return bytes > 256 * 1024 ? Effect.fail(invalid()) : Effect.succeed(chunk);
        }),
        Stream.runCollect,
      );
      const responseBody = Buffer.concat([...chunks]).toString("utf8");
      if (response.status !== 200) {
        const error = yield* decodeRemoteFailure(responseBody).pipe(Effect.mapError(unavailable));
        return yield* error;
      }
      return yield* decodeResult(responseBody).pipe(Effect.mapError(unavailable));
    },
    Effect.timeout("30 seconds"),
    Effect.catchTags({ TimeoutError: () => Effect.fail(unavailable()) }),
  );

  const send = Effect.fn("RemoteContext.send")(
    function* (scope: McpContext.McpInvocationScope, input: RemoteContextSendInput) {
      input = yield* decodeSendInput(input).pipe(Effect.mapError(invalid));
      const context = yield* caller(scope);
      yield* assertLiveCaller(context);
      const project = yield* projects
        .getById(context.caller!.projectId)
        .pipe(Effect.mapError(unavailable));
      if (Option.isNone(project)) return yield* invalid();
      const root = yield* fs
        .realPath(context.caller!.worktreePath ?? project.value.workspaceRoot)
        .pipe(Effect.mapError(invalid));
      const limit = input.maxBytes ?? REMOTE_CONTEXT_MAX_TOTAL_BYTES;
      let total = 0;
      const files: Array<{ path: string; base64: string }> = [];
      for (const file of input.files ?? []) {
        if (!shareablePath(file)) return yield* invalid();
        const resolved = yield* fs
          .realPath(path.resolve(root, file))
          .pipe(Effect.mapError(invalid));
        const relative = path.relative(root, resolved);
        if (
          relative.startsWith(`..${path.sep}`) ||
          relative === ".." ||
          path.isAbsolute(relative) ||
          !shareablePath(relative)
        )
          return yield* invalid();
        const bytes = yield* Effect.scoped(
          Effect.gen(function* () {
            // Keep the canonical path's validated descriptor through the entire read.
            // This also checks file identity on Windows, which lacks O_NOFOLLOW.
            const opened = yield* openMediaFile(resolved).pipe(Effect.mapError(invalid));
            if (opened === null) return yield* invalid();
            if (opened.info.nlink !== 1n) {
              return yield* new OrchestratorMcpFailure({
                code: "invalid_request",
                message: "Files with multiple hard links cannot be shared.",
              });
            }
            const maximumBytes = Math.min(REMOTE_CONTEXT_MAX_FILE_BYTES, limit - total);
            if (opened.info.size > BigInt(maximumBytes)) return yield* invalid();
            const bytes = yield* Effect.tryPromise({
              try: async () => {
                const buffer = new Uint8Array(maximumBytes + 1);
                let offset = 0;
                while (offset < buffer.length) {
                  const { bytesRead } = await opened.handle.read(buffer.subarray(offset));
                  if (bytesRead === 0) break;
                  offset += bytesRead;
                }
                return buffer.subarray(0, offset);
              },
              catch: invalid,
            });
            const after = yield* statMediaFile(resolved, opened).pipe(Effect.mapError(invalid));
            if (after.nlink !== 1n) return yield* invalid();
            return bytes;
          }),
        );
        if (bytes.byteLength > REMOTE_CONTEXT_MAX_FILE_BYTES || total + bytes.byteLength > limit)
          return yield* invalid();
        total += bytes.byteLength;
        files.push({ path: file, base64: Buffer.from(bytes).toString("base64") });
      }
      if (input.message.trim() === "" && files.length === 0) return yield* invalid();
      yield* assertLiveCaller(yield* caller(scope));
      return yield* request(scope, input.environmentId, {
        action: "send",
        threadId: input.threadId,
        message: input.message,
        files,
        clientRequestId: input.clientRequestId,
      });
    },
    Effect.timeout("30 seconds"),
    Effect.catchTags({ TimeoutError: () => Effect.fail(unavailable()) }),
  );

  const receive = Effect.fn("RemoteContext.receive")(function* (token: string, body: string) {
    if (Buffer.byteLength(body) > REMOTE_CONTEXT_MAX_BODY_BYTES) return yield* invalid();
    const { relay } = yield* connection;
    const readSecret = (name: string) =>
      secrets.get(name).pipe(
        Effect.mapError(denied),
        Effect.flatMap((value) =>
          Option.isSome(value)
            ? Effect.succeed(new TextDecoder().decode(value.value))
            : Effect.fail(denied()),
        ),
      );
    const environmentId = yield* environment.getEnvironmentId;
    const proof = yield* verifyRelayJwt({
      token,
      publicKey: yield* readSecret(CLOUD_MINT_PUBLIC_KEY),
      typ: REMOTE_CONTEXT_PROOF_TYP,
      issuer: normalizeRelayIssuer(relay.issuer),
      audience: `t3-env:${environmentId}`,
      nowEpochSeconds: Math.floor((yield* Clock.currentTimeMillis) / 1000),
      maxTokenAge: 120,
    }).pipe(Effect.flatMap(decodeProof), Effect.mapError(denied));
    if (
      proof.environmentId !== environmentId ||
      proof.sub !== (yield* readSecret(CLOUD_LINKED_USER_ID)) ||
      proof.digest !== digest(body)
    )
      return yield* denied();
    const input = yield* decodeRequest(body).pipe(Effect.mapError(invalid));
    if (input.action === "list") {
      const found: Array<Extract<RemoteContextResult, { action: "list" }>["threads"][number]> = [];
      for (const project of yield* projects.listShells().pipe(Effect.mapError(unavailable))) {
        for (const thread of yield* threads
          .listProjectThreads({ projectId: project.id, includeSubagents: false })
          .pipe(Effect.mapError(unavailable))) {
          if (
            thread.deletedAt === null &&
            thread.archivedAt === null &&
            thread.title.toLowerCase().includes(input.query.toLowerCase())
          ) {
            found.push({
              threadId: thread.id,
              title: thread.title.slice(0, 512),
              runtimeMode: thread.runtimeMode,
              interactionMode: thread.interactionMode,
            });
            if (found.length === 50) return { action: "list" as const, threads: found };
          }
        }
      }
      return { action: "list" as const, threads: found };
    }
    const target = yield* threads.getThreadShell(input.threadId).pipe(Effect.mapError(unavailable));
    if (target === null || target.deletedAt !== null || target.archivedAt !== null)
      return yield* invalid();
    yield* assertTargetWithinLimits(proof, target);
    const files = input.files.map((file) => ({
      ...file,
      bytes: Buffer.from(file.base64, "base64"),
    }));
    const totalBytes = files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
    if (
      totalBytes > REMOTE_CONTEXT_MAX_TOTAL_BYTES ||
      files.some(
        (file) =>
          file.bytes.toString("base64") !== file.base64 ||
          file.bytes.byteLength > REMOTE_CONTEXT_MAX_FILE_BYTES ||
          !shareablePath(file.path),
      ) ||
      (input.message.trim() === "" && files.length === 0)
    )
      return yield* invalid();
    const requestKey = digest(
      yield* encodeRequestKey([
        proof.sourceEnvironmentId,
        proof.sourceThreadId,
        input.threadId,
        input.clientRequestId,
      ]).pipe(Effect.mapError(invalid)),
    );
    const attachments: ChatAttachment[] = [];
    const createdPaths: Array<{ id: string; path: string }> = [];
    yield* Effect.gen(function* () {
      for (const [index, file] of files.entries()) {
        const name = path.basename(file.path);
        const attachment: ChatAttachment = {
          type: "file",
          id: `${createDeterministicAttachmentId(
            input.threadId,
            `${requestKey}:${proof.digest}:${index}`,
          )!}-${attachmentFileExtension(name).slice(1)}`,
          name,
          mimeType: "application/octet-stream",
          sizeBytes: file.bytes.byteLength,
        };
        const location = resolveAttachmentPath({
          attachmentsDir: config.attachmentsDir,
          attachment,
        });
        if (location === null) return yield* invalid();
        yield* fs
          .makeDirectory(path.dirname(location), { recursive: true })
          .pipe(Effect.mapError(unavailable));
        // Publish a complete file atomically. Retries never replace an attachment.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const temporary = yield* fs.makeTempFileScoped({
              directory: path.dirname(location),
              suffix: ".part",
            });
            yield* fs.writeFile(temporary, file.bytes);
            const created = yield* fs.link(temporary, location).pipe(
              Effect.as(true),
              Effect.catch((error) =>
                error.reason._tag === "AlreadyExists" ? Effect.succeed(false) : Effect.fail(error),
              ),
              Effect.tap((created) =>
                created
                  ? Effect.sync(() => createdPaths.push({ id: attachment.id, path: location }))
                  : Effect.void,
              ),
              Effect.uninterruptible,
            );
            if (!created) {
              const stored = yield* readFilePrefix(fs, location, file.bytes.byteLength + 1);
              if (!Buffer.from(stored).equals(file.bytes)) return yield* invalid();
            }
          }),
        ).pipe(Effect.catchTags({ PlatformError: () => Effect.fail(unavailable()) }));
        attachments.push(attachment);
      }
    }).pipe(
      Effect.onError(() =>
        Effect.forEach(createdPaths, (file) => fs.remove(file.path).pipe(Effect.ignore)),
      ),
    );
    const header = `Remote context from environment ${yield* encodeString(proof.sourceEnvironmentId).pipe(Effect.mapError(invalid))}, thread ${yield* encodeString(proof.sourceThreadId).pipe(Effect.mapError(invalid))}. This message was sent by an agent. Reply with t3_remote_send using those IDs only if a reply is needed.`;
    const text = `${header}\n\n${input.message}${files.length === 0 ? "" : `\n\nFiles:\n${files.map((file) => file.path).join("\n")}`}`;
    const accepted = yield* Intake.sendToThread({
      projectId: target.projectId,
      threadId: target.id,
      commandId: CommandId.make(`remote-context:${requestKey}`),
      messageId: MessageId.make(`remote-context:${requestKey}`),
      text,
      attachments,
      mode: "auto",
      createdBy: "agent",
      creationSource: "mcp",
    }).pipe(
      Effect.provideService(DispatchModeLimit, proof),
      Effect.provideService(Threads.ThreadManagementService, threads),
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Config.ServerConfig, config),
      Effect.mapError(unavailable),
    );
    if (
      accepted.message.text !== text ||
      accepted.message.attachments.length !== attachments.length ||
      accepted.message.attachments.some(
        (attachment, index) => attachment.id !== attachments[index]?.id,
      )
    ) {
      const retained = new Set(accepted.message.attachments.map((attachment) => attachment.id));
      yield* Effect.forEach(
        createdPaths.filter((file) => !retained.has(file.id)),
        (file) => fs.remove(file.path).pipe(Effect.ignore),
      );
      return yield* invalid();
    }
    return { action: "send" as const, threadId: target.id, fileCount: files.length, totalBytes };
  }, publicationLock.withPermits(1));

  return RemoteContext.of({
    peers: (scope) =>
      caller(scope).pipe(
        Effect.andThen(connection),
        Effect.flatMap(({ client }) => client.peers.list().pipe(Effect.mapError(relayFailure))),
      ),
    search: (scope, input) =>
      request(scope, input.environmentId, { action: "list", query: input.query }),
    send,
    receive,
  });
});

export const layer = Layer.effect(RemoteContext, make);
