// @effect-diagnostics nodeBuiltinImport:off -- Sign test relay proofs and compare exact transferred bytes.
import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  REMOTE_CONTEXT_MAX_FILE_BYTES,
  REMOTE_CONTEXT_PROOF_TYP,
  type Project,
  type RemoteContextProof,
  type RemoteContextRequest,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as HttpClient from "effect/http/HttpClient";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";

import * as Secrets from "../auth/ServerSecretStore.ts";
import {
  CLOUD_LINKED_USER_ID,
  CLOUD_MINT_PUBLIC_KEY,
  RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
  RELAY_ISSUER_SECRET,
  RELAY_URL_SECRET,
} from "../cloud/config.ts";
import * as Config from "../config.ts";
import * as Environment from "../environment/ServerEnvironment.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import { DispatchModeLimit } from "../orchestration-v2/DispatchModeLimit.ts";
import * as Projects from "../project/ProjectService.ts";
import { resolveAttachmentPath, resolveAttachmentPathById } from "../attachmentStore.ts";
import * as RemoteContext from "./RemoteContext.ts";

const keys = NodeCrypto.generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const environmentId = EnvironmentId.make("receiver");
const threadId = ThreadId.make("remote-thread");
const scope: McpInvocationScope = {
  environmentId,
  requestNamespace: "caller-session",
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
  client: undefined,
  thread: {
    threadId,
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerSessionId: "session",
  },
};
const sha = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");
function proofFor(body: string, now: number, overrides: Partial<RemoteContextProof> = {}) {
  const payload: RemoteContextProof = {
    environmentId,
    sourceEnvironmentId: EnvironmentId.make("sender"),
    sourceThreadId: ThreadId.make("sender-thread"),
    digest: sha(body),
    runtimeMode: "full-access",
    interactionMode: "default",
    iss: "https://relay.test",
    aud: "t3-env:receiver",
    sub: "owner",
    jti: "proof-id",
    iat: now,
    exp: now + 120,
    ...overrides,
  };
  const content = `${Buffer.from(JSON.stringify({ alg: "EdDSA", typ: REMOTE_CONTEXT_PROOF_TYP })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  return `${content}.${NodeCrypto.sign(null, Buffer.from(content), keys.privateKey).toString("base64url")}`;
}

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-remote-context-" });
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
  const configuration = yield* Config.ServerConfig.pipe(
    Effect.provide(Config.layerTest(root, root)),
  );
  const accepted: Threads.ThreadManagementSendInput[] = [];
  const receipts = new Map<string, Threads.ThreadManagementSendResult>();
  const outbound: HttpClientRequest.HttpClientRequest[] = [];
  let response = () =>
    new Response(JSON.stringify({ action: "send", threadId, fileCount: 1, totalBytes: 4 }));
  const limits: Array<unknown> = [];
  const target = liveThreadShell(threadId);
  let currentTarget = target;
  const secretValues = new Map([
    [RELAY_URL_SECRET, "https://relay.test"],
    [RELAY_ISSUER_SECRET, "https://relay.test"],
    [RELAY_ENVIRONMENT_CREDENTIAL_SECRET, "environment-credential"],
    [CLOUD_MINT_PUBLIC_KEY, keys.publicKey],
    [CLOUD_LINKED_USER_ID, "owner"],
  ]);
  const dependencies = Layer.mergeAll(
    Layer.mock(Secrets.ServerSecretStore)({
      get: (name) =>
        Effect.succeed(
          Option.fromNullishOr(secretValues.get(name)).pipe(
            Option.map((value) => new TextEncoder().encode(value)),
          ),
        ),
    }),
    Layer.mock(Environment.ServerEnvironment)({ getEnvironmentId: Effect.succeed(environmentId) }),
    Layer.succeed(Config.ServerConfig, { ...configuration, attachmentsDir: `${root}/attachments` }),
    Layer.mock(Projects.ProjectService)({
      getById: () => Effect.succeedSome({ id: target.projectId, workspaceRoot: root } as Project),
      listShells: () => Effect.succeed([]),
    }),
    Layer.mock(Threads.ThreadManagementService)({
      getThreadShell: (id) => Effect.succeed({ ...currentTarget, id }),
      sendToThread: (input) =>
        Effect.gen(function* () {
          accepted.push(input);
          limits.push(yield* DispatchModeLimit);
          const result =
            receipts.get(input.commandId) ??
            ({
              message: { text: input.text, attachments: input.attachments },
            } as Threads.ThreadManagementSendResult);
          receipts.set(input.commandId, result);
          return result;
        }),
    }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          outbound.push(request);
          return HttpClientResponse.fromWeb(request, response());
        }),
      ),
    ),
  );
  const context = yield* Layer.build(RemoteContext.layer.pipe(Layer.provide(dependencies)));
  const service = Context.get(context, RemoteContext.RemoteContext);
  const receive = (input: RemoteContextRequest, overrides: Partial<RemoteContextProof> = {}) => {
    const body = JSON.stringify(input);
    return service.receive(proofFor(body, now, overrides), body);
  };
  const send = (files: string[], maxBytes?: number) =>
    service.send(scope, {
      environmentId: EnvironmentId.make("other"),
      threadId,
      message: "Review these changes",
      files,
      clientRequestId: "stable-request",
      ...(maxBytes === undefined ? {} : { maxBytes }),
    });
  return {
    fs,
    root,
    now,
    service,
    receive,
    send,
    accepted,
    outbound,
    limits,
    target,
    setTarget: (next: typeof target) => {
      currentTarget = next;
    },
    secretValues,
    setResponse: (next: typeof response) => {
      response = next;
    },
  };
});

const fileMessage = (
  base64 = Buffer.from("code").toString("base64"),
): Extract<RemoteContextRequest, { action: "send" }> => ({
  action: "send",
  threadId,
  clientRequestId: "test-send",
  message: "Review parser changes",
  files: [{ path: "src/parser.ts", base64 }],
});

const authorizedFetch: typeof globalThis.fetch = async () =>
  new Response(JSON.stringify({ httpBaseUrl: "https://peer.test", proof: "test-proof" }), {
    headers: { "content-type": "application/json" },
  });

describe("remote context", () => {
  it.effect.each([
    {
      modes: { runtimeMode: "approval-required" as const },
      code: "runtime_mode_escalation_denied",
    },
    { modes: { interactionMode: "plan" as const }, code: "interaction_mode_escalation_denied" },
  ])("blocks a stale proof after the caller's modes narrow: %j", ({ modes, code }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* setup;
        let authorizations = 0;
        const fetch: typeof globalThis.fetch = async (...args) => {
          authorizations += 1;
          h.setTarget({ ...h.target, ...modes });
          return authorizedFetch(...args);
        };
        const error = yield* h
          .send([])
          .pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), Effect.flip);
        expect(error.code).toBe(code);
        expect(authorizations).toBe(1);
        expect(h.outbound).toHaveLength(0);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps retry IDs distinct across destination threads", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* setup;
        const first = fileMessage();
        const second = { ...fileMessage(), threadId: ThreadId.make("another-thread") };
        yield* h.receive(first);
        yield* h.receive(second);
        yield* h.receive(first);
        yield* h.receive(second);
        const [a, b, retryA, retryB] = h.accepted;
        expect(a!.threadId).toBe(first.threadId);
        expect(b!.threadId).toBe(second.threadId);
        expect(a!.commandId).not.toBe(b!.commandId);
        expect(a!.messageId).not.toBe(b!.messageId);
        expect(a!.attachments[0]!.id).not.toBe(b!.attachments[0]!.id);
        expect(retryA!.commandId).toBe(a!.commandId);
        expect(retryA!.messageId).toBe(a!.messageId);
        expect(retryA!.attachments).toEqual(a!.attachments);
        expect(retryB!.commandId).toBe(b!.commandId);
        expect(retryB!.messageId).toBe(b!.messageId);
        expect(retryB!.attachments).toEqual(b!.attachments);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.each(["symlink", "hardlink"] as const)(
    "rejects a source replaced by a credential %s after path validation",
    (replacement) =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          let swapped = false;
          const h = yield* setup.pipe(
            Effect.provideService(FileSystem.FileSystem, {
              ...fs,
              realPath: (file) =>
                fs.realPath(file).pipe(
                  Effect.tap((resolved) =>
                    Effect.gen(function* () {
                      if (swapped || !file.endsWith("/source.txt")) return;
                      swapped = true;
                      yield* fs.remove(resolved);
                      const credential = resolved.replace(/source\.txt$/, ".env");
                      if (replacement === "symlink") yield* fs.symlink(credential, resolved);
                      else yield* fs.link(credential, resolved);
                    }),
                  ),
                ),
            }),
          );
          yield* fs.writeFileString(`${h.root}/source.txt`, "public code");
          yield* fs.writeFileString(`${h.root}/.env`, "private credential");
          expect(
            (yield* h
              .send(["source.txt"])
              .pipe(Effect.provideService(FetchHttpClient.Fetch, authorizedFetch), Effect.flip))
              .code,
          ).toBe("invalid_request");
          expect(swapped).toBe(true);
          expect(h.outbound).toHaveLength(0);
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.each(["", "code"])(
    "sends and stores file content %j within its exact byte budget",
    (content) =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* setup;
          const name = content === "" ? ".gitkeep" : "file.ts";
          const byteCount = Buffer.byteLength(content);
          yield* h.fs.writeFileString(`${h.root}/${name}`, content);
          h.setResponse(
            () =>
              new Response(
                JSON.stringify({ action: "send", threadId, fileCount: 1, totalBytes: byteCount }),
              ),
          );
          const result = yield* h
            .send([name], byteCount)
            .pipe(Effect.provideService(FetchHttpClient.Fetch, authorizedFetch));
          expect(result).toMatchObject({ fileCount: 1, totalBytes: byteCount });
          const body = h.outbound[0]!.body;
          expect(body._tag).toBe("Uint8Array");
          if (body._tag !== "Uint8Array") throw new Error("Expected a JSON request body");
          const payload = JSON.parse(new TextDecoder().decode(body.body));
          expect(payload.files).toEqual([
            { path: name, base64: Buffer.from(content).toString("base64") },
          ]);
          yield* h.receive({ ...payload, message: "" });
          const attachment = h.accepted[0]!.attachments[0]!;
          expect(attachment.sizeBytes).toBe(byteCount);
          const location = resolveAttachmentPath({
            attachmentsDir: `${h.root}/attachments`,
            attachment,
          })!;
          expect(yield* h.fs.readFileString(location)).toBe(content);
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.each(["oversized", "broken"] as const)(
    "preserves the %s response error category",
    (kind) =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* setup;
          let cancelled = false;
          h.setResponse(
            () =>
              new Response(
                new ReadableStream<Uint8Array>({
                  pull: (controller) => {
                    if (kind === "broken") controller.error(new Error("connection lost"));
                    else controller.enqueue(new Uint8Array(256 * 1024 + 1));
                  },
                  cancel: () => {
                    cancelled = true;
                  },
                }),
              ),
          );
          const error = yield* h
            .send([])
            .pipe(Effect.provideService(FetchHttpClient.Fetch, authorizedFetch), Effect.flip);
          expect(error.code).toBe(kind === "oversized" ? "invalid_request" : "orchestration_error");
          if (kind === "oversized") expect(cancelled).toBe(true);
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.each(["environment", "capability", "link"] as const)(
    "preserves peer-list authorization failure for %s",
    (reason) =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* setup;
          if (reason === "link") h.secretValues.delete(RELAY_ENVIRONMENT_CREDENTIAL_SECRET);
          const callerScope = {
            ...scope,
            ...(reason === "environment" ? { environmentId: EnvironmentId.make("other") } : {}),
            ...(reason === "capability" ? { capabilities: new Set<never>() } : {}),
          };
          expect((yield* h.service.peers(callerScope).pipe(Effect.flip)).code).toBe(
            "capability_denied",
          );
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect.each([401, 503])("maps relay rejection %s for peer listing and sending", (status) =>
    Effect.scoped(
      Effect.gen(function* () {
        const error =
          status === 401
            ? {
                _tag: "RelayAuthInvalidError",
                code: "auth_invalid",
                reason: "invalid_bearer",
                traceId: "test",
              }
            : {
                _tag: "RelayInternalError",
                code: "internal_error",
                reason: "database_unavailable",
                traceId: "test",
              };
        const fetch: typeof globalThis.fetch = async () =>
          new Response(JSON.stringify(error), {
            status,
            headers: { "content-type": "application/json" },
          });
        const h = yield* setup;
        for (const request of [
          h.service.peers(scope).pipe(Effect.asVoid),
          h.send([]).pipe(Effect.asVoid),
        ]) {
          expect(
            (yield* request.pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), Effect.flip))
              .code,
          ).toBe(status === 401 ? "capability_denied" : "orchestration_error");
        }
        expect(h.outbound).toHaveLength(0);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "rolls back files published before a conflicting attachment without removing the conflict",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* setup;
          const request = {
            ...fileMessage(),
            files: [
              ...fileMessage().files,
              { path: "src/other.ts", base64: Buffer.from("second file").toString("base64") },
            ],
          };
          yield* h.receive(request);
          const [first, second] = h.accepted[0]!.attachments;
          const location = (attachment: NonNullable<typeof first>) =>
            resolveAttachmentPath({ attachmentsDir: `${h.root}/attachments`, attachment })!;
          yield* h.fs.remove(location(first!));
          yield* h.fs.writeFileString(location(second!), "conflicting bytes");
          const before = yield* h.fs.readDirectory(`${h.root}/attachments`);
          const error = yield* h.receive(request).pipe(Effect.flip);
          expect(error.code).toBe("invalid_request");
          expect(yield* h.fs.readDirectory(`${h.root}/attachments`)).toEqual(before);
          expect(yield* h.fs.readFileString(location(second!))).toBe("conflicting bytes");
          expect(h.accepted).toHaveLength(1);
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects a workspace hard link to a credential file before network access", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* setup;
        yield* h.fs.writeFileString(`${h.root}/.env`, "private credential");
        yield* h.fs.link(`${h.root}/.env`, `${h.root}/notes.txt`);
        const error = yield* h.send(["notes.txt"]).pipe(Effect.flip);
        expect(error.code).toBe("invalid_request");
        expect(error.message).toBe("Files with multiple hard links cannot be shared.");
        expect(h.outbound).toHaveLength(0);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "refuses a changed payload on an existing request ID and removes its unused files",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* setup;
          yield* h.receive(fileMessage());
          const before = yield* h.fs.readDirectory(`${h.root}/attachments`);
          const error = yield* h
            .receive({
              ...fileMessage(Buffer.from("new bytes").toString("base64")),
              message: "Different payload",
            })
            .pipe(Effect.flip);
          expect(error.code).toBe("invalid_request");
          expect(yield* h.fs.readDirectory(`${h.root}/attachments`)).toEqual(before);
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "sends exact workspace bytes through the tunnel and sends only a digest to the relay",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const relayCalls: Array<{ url: string; init: RequestInit }> = [];
          const fetch: typeof globalThis.fetch = async (url, init) => {
            relayCalls.push({ url: String(url), init: init ?? {} });
            return new Response(
              JSON.stringify({
                httpBaseUrl: "https://other.test",
                proof: "private-transfer-proof",
              }),
              { headers: { "content-type": "application/json" } },
            );
          };
          const h = yield* setup;
          yield* h.fs.writeFileString(`${h.root}/file.ts`, "code");
          expect(
            yield* h.send(["file.ts"]).pipe(Effect.provideService(FetchHttpClient.Fetch, fetch)),
          ).toEqual({
            action: "send",
            threadId,
            fileCount: 1,
            totalBytes: 4,
          });
          expect(relayCalls).toHaveLength(1);
          expect(relayCalls[0]!.url).toBe("https://relay.test/v1/peers/authorize");
          const transfer = h.outbound[0]!;
          expect(transfer.url).toBe("https://other.test/api/connect/thread-context");
          const text =
            transfer.body._tag === "Uint8Array" ? new TextDecoder().decode(transfer.body.body) : "";
          const payload = JSON.parse(text) as { files: Array<{ path: string; base64: string }> };
          expect(payload.files).toEqual([
            { path: "file.ts", base64: Buffer.from("code").toString("base64") },
          ]);
          const relayBody = JSON.parse(
            new TextDecoder().decode(relayCalls[0]!.init.body as Uint8Array),
          ) as { digest: string; files?: unknown };
          expect(relayBody.digest).toBe(sha(text));
          expect(relayBody.files).toBeUndefined();
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "stores exact bytes as thread attachments and carries the sender's permission limit",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* setup;
          const result = yield* h.receive(fileMessage());
          expect(result).toEqual({ action: "send", threadId, fileCount: 1, totalBytes: 4 });
          const attachment = h.accepted[0]!.attachments[0]!;
          const location = resolveAttachmentPath({
            attachmentsDir: `${h.root}/attachments`,
            attachment,
          })!;
          expect(
            resolveAttachmentPathById({
              attachmentsDir: `${h.root}/attachments`,
              attachmentId: attachment.id,
            }),
          ).toBe(location);
          expect(yield* h.fs.readFileString(location)).toBe("code");
          expect(attachment.name).toBe("parser.ts");
          expect(h.accepted[0]!.text).toContain("sender-thread");
          expect(h.limits[0]).toMatchObject({
            runtimeMode: "full-access",
            interactionMode: "default",
          });
          expect(yield* h.fs.exists(`${h.root}/src/parser.ts`)).toBe(false);
          yield* h.receive(fileMessage());
          expect(h.accepted[1]!.commandId).toBe(h.accepted[0]!.commandId);
          expect(h.accepted[1]!.attachments).toEqual(h.accepted[0]!.attachments);
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "rejects altered bytes, another account, another destination, and expired proofs before storing files",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* setup;
          for (const overrides of [
            { sub: "other-owner" },
            { aud: "t3-env:other" },
            { exp: h.now - 60 },
            { digest: "0".repeat(64) },
          ]) {
            expect((yield* h.receive(fileMessage(), overrides).pipe(Effect.flip)).code).toBe(
              "capability_denied",
            );
          }
          expect(h.accepted).toHaveLength(0);
          expect(yield* h.fs.exists(`${h.root}/attachments`)).toBe(false);
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses permission escalation and a single file above 2 MiB", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* setup;
        expect(
          (yield* h.receive(fileMessage(), { runtimeMode: "approval-required" }).pipe(Effect.flip))
            .code,
        ).toBe("runtime_mode_escalation_denied");
        expect(
          (yield* h
            .receive(
              fileMessage(Buffer.alloc(REMOTE_CONTEXT_MAX_FILE_BYTES + 1).toString("base64")),
            )
            .pipe(Effect.flip)).code,
        ).toBe("invalid_request");
        expect(h.accepted).toHaveLength(0);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("accepts the exact per-file limit without returning file data", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* setup;
        const result = yield* h.receive(
          fileMessage(Buffer.alloc(REMOTE_CONTEXT_MAX_FILE_BYTES, 65).toString("base64")),
        );
        expect(result).toMatchObject({ totalBytes: REMOTE_CONTEXT_MAX_FILE_BYTES, fileCount: 1 });
        expect(JSON.stringify(result).length).toBeLessThan(200);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "rejects aggregate overflow, too many files, and noncanonical base64 before storing files",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* setup;
          const file = {
            path: "file.ts",
            base64: Buffer.alloc(REMOTE_CONTEXT_MAX_FILE_BYTES, 65).toString("base64"),
          };
          const base = {
            action: "send" as const,
            threadId,
            clientRequestId: "bounded",
            message: "Review",
          };
          for (const files of [
            Array.from({ length: 5 }, () => file),
            Array.from({ length: 9 }, () => ({ path: "file.ts", base64: "YQ==" })),
            [{ path: "file.ts", base64: "YR==" }],
          ]) {
            expect((yield* h.receive({ ...base, files }).pipe(Effect.flip)).code).toBe(
              "invalid_request",
            );
          }
          expect(h.accepted).toHaveLength(0);
          expect(yield* h.fs.exists(`${h.root}/attachments`)).toBe(false);
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("accepts a message without files and preserves code context", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const h = yield* setup;
        const result = yield* h.receive({
          action: "send",
          threadId,
          clientRequestId: "context-only",
          message: "Patch: + return parsed.value",
          files: [],
        });
        expect(result).toMatchObject({ fileCount: 0, totalBytes: 0 });
        expect(h.accepted[0]!.text).toContain("Patch: + return parsed.value");
        expect(h.accepted[0]!.attachments).toEqual([]);
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "rejects paths outside the workspace, known credentials, and a lower caller budget before network access",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const h = yield* setup;
          yield* h.fs.writeFileString(`${h.root}/file.ts`, "code");
          yield* h.fs.writeFileString(`${h.root}/.env`, "secret");
          const outside = yield* h.fs.makeTempDirectoryScoped();
          yield* h.fs.writeFileString(`${outside}/file.ts`, "private");
          yield* h.fs.symlink(`${outside}/file.ts`, `${h.root}/linked.ts`);
          for (const files of [["../file.ts"], ["/tmp/file.ts"], [".env"], ["linked.ts"]]) {
            expect((yield* h.send(files).pipe(Effect.flip)).code).toBe("invalid_request");
          }
          expect((yield* h.send(["file.ts"], 3).pipe(Effect.flip)).code).toBe("invalid_request");
          expect(h.accepted).toHaveLength(0);
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
  );
});
