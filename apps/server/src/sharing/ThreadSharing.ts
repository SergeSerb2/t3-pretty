import { ThreadId, ThreadShareError, ThreadShareInfo } from "@t3tools/contracts";
import { stripHiddenInstructionSuffixes } from "@t3tools/shared/hiddenInstructionBlocks";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { timingSafeEqualBase64Url } from "../auth/utils.ts";

const MAX_SHARE_BYTES = 2 * 1024 * 1024;
const StoredShare = Schema.Struct({
  threadId: ThreadId,
  token: Schema.String,
  url: Schema.String,
  publishedAt: Schema.String,
  title: Schema.String,
  messages: Schema.Array(
    Schema.Struct({
      role: Schema.Literals(["user", "assistant"]),
      text: Schema.String,
    }),
  ),
});
type StoredShare = typeof StoredShare.Type;
const storedShareJson = Schema.fromJsonString(StoredShare);
const decodeStoredShare = Schema.decodeEffect(storedShareJson);
const encodeStoredShare = Schema.encodeEffect(storedShareJson);
const isThreadShareError = Schema.is(ThreadShareError);
const info = (share: StoredShare) => ({
  url: share.url,
  publishedAt: share.publishedAt,
  messageCount: share.messages.length,
});

export class ThreadSharing extends Context.Service<
  ThreadSharing,
  {
    readonly get: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<ThreadShareInfo | null, ThreadShareError>;
    readonly publish: (input: {
      readonly threadId: ThreadId;
      readonly publicBaseUrl: string;
    }) => Effect.Effect<ThreadShareInfo, ThreadShareError>;
    readonly revoke: (input: {
      readonly threadId: ThreadId;
    }) => Effect.Effect<void, ThreadShareError>;
    readonly readPublic: (
      key: string,
      token: string,
    ) => Effect.Effect<StoredShare | null, ThreadShareError>;
  }
>()("t3/sharing/ThreadSharing") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const crypto = yield* Crypto.Crypto;
  const lock = yield* Semaphore.make(1);
  const shareKey = (threadId: ThreadId) =>
    crypto.digest("SHA-256", new TextEncoder().encode(threadId)).pipe(
      Effect.map((bytes) => Buffer.from(bytes).toString("hex")),
      Effect.orDie,
    );
  const directory = path.join(config.stateDir, "thread-shares");
  const file = (key: string) => path.join(directory, `${key}.json`);
  const storageError = (cause: unknown) => new ThreadShareError({ reason: "storage", cause });
  const read = (key: string) =>
    fs.readFileString(file(key)).pipe(
      Effect.flatMap(decodeStoredShare),
      Effect.map((value): StoredShare | null => value),
      Effect.catchTags({
        PlatformError: (cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeed(null)
            : Effect.fail(storageError(cause)),
      }),
      Effect.mapError((cause) => (isThreadShareError(cause) ? cause : storageError(cause))),
    );
  const get = ({ threadId }: { readonly threadId: ThreadId }) =>
    shareKey(threadId).pipe(
      Effect.flatMap(read),
      Effect.map((share) => (share === null ? null : info(share))),
    );
  const publish = Effect.fn("ThreadSharing.publish")(function* (input: {
    readonly threadId: ThreadId;
    readonly publicBaseUrl: string;
  }) {
    const base = URL.parse(input.publicBaseUrl.trim());
    if (
      !base ||
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== "/"
    ) {
      return yield* new ThreadShareError({ reason: "invalid-url" });
    }
    const { projection } = yield* threads
      .getThreadSnapshot(input.threadId)
      .pipe(Effect.mapError((cause) => new ThreadShareError({ reason: "unavailable", cause })));
    if (projection.thread.deletedAt !== null)
      return yield* new ThreadShareError({ reason: "unavailable" });
    const messages = projection.visibleTurnItems.flatMap(({ item }) => {
      if (item.type !== "user_message" && item.type !== "assistant_message") return [];
      const role = item.type === "user_message" ? ("user" as const) : ("assistant" as const);
      const text = (role === "user" ? stripHiddenInstructionSuffixes(item.text) : item.text).trim();
      return text ? [{ role, text }] : [];
    });
    if (messages.length === 0) return yield* new ThreadShareError({ reason: "empty" });
    const key = yield* shareKey(input.threadId);
    const existing = yield* read(key);
    const token =
      existing?.token ?? (yield* crypto.randomUUIDv4().pipe(Effect.orDie)).replaceAll("-", "");
    const share: StoredShare = {
      threadId: input.threadId,
      token,
      url: `${base.origin}/share/${key}/${token}`,
      publishedAt: DateTime.formatIso(yield* DateTime.now),
      title: projection.thread.title,
      messages,
    };
    const json = yield* encodeStoredShare(share).pipe(Effect.mapError(storageError));
    if (Buffer.byteLength(json, "utf8") > MAX_SHARE_BYTES)
      return yield* new ThreadShareError({ reason: "too-large" });
    // Rename publishes the complete snapshot atomically. Reads never see a partial write.
    yield* Effect.gen(function* () {
      yield* fs.makeDirectory(directory, { recursive: true });
      const temporary = `${file(key)}.tmp`;
      yield* fs.writeFileString(temporary, json, { mode: 0o600 });
      yield* fs.rename(temporary, file(key));
    }).pipe(Effect.mapError(storageError));
    return info(share);
  });
  const revoke = ({ threadId }: { readonly threadId: ThreadId }) =>
    shareKey(threadId).pipe(
      Effect.flatMap((key) => fs.remove(file(key), { force: true })),
      Effect.mapError(storageError),
    );
  const readPublic = Effect.fnUntraced(function* (key: string, token: string) {
    if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{32}$/.test(token)) return null;
    const share = yield* read(key);
    if (share === null || !timingSafeEqualBase64Url(share.token, token)) return null;
    // Deleting a thread also makes its snapshot unavailable, without reading its transcript.
    const exists = yield* threads.getThreadShell(share.threadId).pipe(
      Effect.map((shell) => shell !== null && shell.deletedAt === null),
      Effect.orElseSucceed(() => false),
    );
    return exists ? share : null;
  });
  return ThreadSharing.of({
    get,
    publish: (input) => lock.withPermits(1)(publish(input)),
    revoke: (input) => lock.withPermits(1)(revoke(input)),
    readPublic,
  });
});

export const layer = Layer.effect(ThreadSharing, make);
