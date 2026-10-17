import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { CREATE_PULL_REQUEST_MESSAGE_SUFFIX } from "@t3tools/shared/createPullRequestPrompt";
import { ThreadId, type OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpRouter from "effect/http/HttpRouter";
import * as ServerConfig from "../config.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Sharing from "./ThreadSharing.ts";
import * as SharingHttp from "./http.ts";

const threadId = ThreadId.make("thread:test-sharing");
type Message = {
  type: "user_message" | "assistant_message" | "reasoning" | "tool_call";
  text: string;
};
const fixture = () => {
  const state = {
    deleted: false,
    messages: [
      {
        type: "user_message",
        text: `Explain <script>alert(1)</script>.${CREATE_PULL_REQUEST_MESSAGE_SUFFIX}`,
      },
      { type: "reasoning", text: "PRIVATE REASONING" },
      { type: "tool_call", text: "PRIVATE TOOL OUTPUT" },
      { type: "assistant_message", text: "It is a script. Do not execute it." },
    ] as Message[],
  };
  // Only the external projection service is replaced. Storage, snapshots, tokens, and HTTP are real.
  const source = Layer.mock(Threads.ThreadManagementService)({
    getThreadSnapshot: () =>
      Effect.succeed({
        schemaVersion: 2,
        snapshotSequence: 1,
        projection: {
          thread: {
            id: threadId,
            title: "A shared conversation",
            deletedAt: state.deleted ? "deleted" : null,
          },
          visibleTurnItems: state.messages.map((item) => ({ item })),
        } as unknown as OrchestrationV2ThreadProjection,
      }),
    getThreadShell: () =>
      Effect.succeed(
        state.deleted
          ? null
          : ({
              id: threadId,
              deletedAt: null,
            } as NonNullable<
              Effect.Success<
                ReturnType<Threads.ThreadManagementService["Service"]["getThreadShell"]>
              >
            >),
      ),
  });
  const layer = Sharing.layer.pipe(
    Layer.provideMerge(source),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-sharing-" })),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(NodeCrypto.layer),
  );
  return { state, layer };
};
const parts = (url: string) => {
  const [, , key = "", token = ""] = new URL(url).pathname.split("/");
  return { key, token };
};

it.effect(
  "publishes a fixed snapshot, persists it across service instances, and revokes old links",
  () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      const sharing = yield* Sharing.ThreadSharing;
      expect(yield* sharing.get({ threadId })).toBeNull();
      const first = yield* sharing.publish({
        threadId,
        publicBaseUrl: "https://threads.example.test/",
      });
      const { key, token } = parts(first.url);
      expect(first.messageCount).toBe(2);
      expect((yield* sharing.readPublic(key, token))?.messages[0]?.text).toBe(
        "Explain <script>alert(1)</script>.",
      );
      expect(
        (yield* sharing.readPublic(key, token))?.messages.map((message) => message.role),
      ).toEqual(["user", "assistant"]);
      expect(yield* sharing.readPublic(key, "0".repeat(32))).toBeNull();
      expect(yield* sharing.readPublic("../anything", token)).toBeNull();
      state.messages.push({ type: "assistant_message", text: "A later private message." });
      expect((yield* sharing.readPublic(key, token))?.messages).toHaveLength(2);
      const updated = yield* sharing.publish({
        threadId,
        publicBaseUrl: "https://threads.example.test",
      });
      expect(updated.url).toBe(first.url);
      expect((yield* sharing.readPublic(key, token))?.messages).toHaveLength(3);
      // A fresh service reads the same persisted file, as after a server restart.
      const restarted = yield* Sharing.ThreadSharing.pipe(Effect.provide(Sharing.layer));
      expect(yield* restarted.get({ threadId })).toEqual(updated);
      yield* restarted.revoke({ threadId });
      expect(yield* sharing.get({ threadId })).toBeNull();
      expect(yield* sharing.readPublic(key, token)).toBeNull();
      const next = yield* sharing.publish({
        threadId,
        publicBaseUrl: "https://threads.example.test",
      });
      expect(next.url).not.toBe(first.url);
      state.deleted = true;
      const nextParts = parts(next.url);
      expect(yield* sharing.readPublic(nextParts.key, nextParts.token)).toBeNull();
    }).pipe(Effect.provide(layer));
  },
);

it.effect(
  "rejects invalid origins, empty conversations, and oversized snapshots without replacing an existing share",
  () => {
    const { state, layer } = fixture();
    return Effect.gen(function* () {
      const sharing = yield* Sharing.ThreadSharing;
      for (const publicBaseUrl of [
        "javascript:alert(1)",
        "https://user:secret@host.test",
        "https://host.test?token=secret",
        "https://host.test/path",
      ]) {
        expect((yield* sharing.publish({ threadId, publicBaseUrl }).pipe(Effect.flip)).reason).toBe(
          "invalid-url",
        );
      }
      const saved = yield* sharing.publish({ threadId, publicBaseUrl: "https://host.test" });
      state.messages = [];
      expect(
        (yield* sharing.publish({ threadId, publicBaseUrl: "https://host.test" }).pipe(Effect.flip))
          .reason,
      ).toBe("empty");
      state.messages = [{ type: "user_message", text: "a".repeat(2 * 1024 * 1024) }];
      expect(
        (yield* sharing.publish({ threadId, publicBaseUrl: "https://host.test" }).pipe(Effect.flip))
          .reason,
      ).toBe("too-large");
      expect(yield* sharing.get({ threadId })).toEqual(saved);
    }).pipe(Effect.provide(layer));
  },
);

it.effect("serves escaped text without authentication and returns 404 after revocation", () => {
  const { layer } = fixture();
  return Effect.gen(function* () {
    const sharing = yield* Sharing.ThreadSharing;
    const share = yield* sharing.publish({ threadId, publicBaseUrl: "https://host.test" });
    const { handler, dispose } = HttpRouter.toWebHandler(
      SharingHttp.layer.pipe(Layer.provide(Layer.succeed(Sharing.ThreadSharing, sharing))),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(dispose));
    const response = yield* Effect.promise(() => handler(new Request(share.url)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = yield* Effect.promise(() => response.text());
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("create_pull_request_instructions");
    expect(html).not.toContain("PRIVATE REASONING");
    expect(html).not.toContain("PRIVATE TOOL OUTPUT");
    yield* sharing.revoke({ threadId });
    expect((yield* Effect.promise(() => handler(new Request(share.url)))).status).toBe(404);
  }).pipe(Effect.scoped, Effect.provide(layer));
});
