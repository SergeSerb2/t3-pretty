import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { REMOTE_CONTEXT_MAX_BODY_BYTES, REMOTE_CONTEXT_ROUTE, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";
import * as HttpRouter from "effect/http/HttpRouter";

import * as RemoteContext from "./RemoteContext.ts";
import * as RemoteContextHttp from "./RemoteContextHttp.ts";

it("bounds declared and streamed request sizes before calling the transfer service", async () => {
  const received: string[] = [];
  const routes = RemoteContextHttp.layer.pipe(
    Layer.provide(
      Layer.mock(RemoteContext.RemoteContext)({
        receive: (_token, body) =>
          Effect.sync(() => {
            received.push(body);
            return {
              action: "send" as const,
              threadId: ThreadId.make("target"),
              fileCount: 0,
              totalBytes: 0,
            };
          }),
      }),
    ),
    Layer.provideMerge(
      HttpPlatform.layer.pipe(
        Layer.provideMerge(NodeServices.layer),
        Layer.provideMerge(Etag.layerWeak),
      ),
    ),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
  const url = `http://localhost${REMOTE_CONTEXT_ROUTE}`;
  try {
    const noToken = await handler(new Request(url, { method: "POST", body: "{}" }));
    expect(noToken.status).toBe(401);
    const declared = await handler(
      new Request(url, {
        method: "POST",
        headers: {
          authorization: "Bearer proof",
          "content-length": String(REMOTE_CONTEXT_MAX_BODY_BYTES + 1),
        },
        body: "{}",
      }),
    );
    expect(declared.status).toBe(413);
    const streamed = await handler(
      new Request(url, {
        method: "POST",
        headers: { authorization: "Bearer proof" },
        body: "x".repeat(REMOTE_CONTEXT_MAX_BODY_BYTES + 1),
      }),
    );
    expect(streamed.status).toBe(413);
    expect(received).toHaveLength(0);
    const valid = await handler(
      new Request(url, { method: "POST", headers: { authorization: "Bearer proof" }, body: "{}" }),
    );
    expect(valid.status).toBe(200);
    expect(received).toEqual(["{}"]);
  } finally {
    await dispose();
  }
});
