import { REMOTE_CONTEXT_MAX_BODY_BYTES, REMOTE_CONTEXT_ROUTE } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import * as RemoteContext from "./RemoteContext.ts";

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const service = yield* RemoteContext.RemoteContext;
    return HttpRouter.add(
      "POST",
      REMOTE_CONTEXT_ROUTE,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const token = request.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
        if (token === undefined || token.length > 64 * 1024)
          return HttpServerResponse.empty({ status: 401 });
        if (Number(request.headers["content-length"]) > REMOTE_CONTEXT_MAX_BODY_BYTES)
          return HttpServerResponse.empty({ status: 413 });
        let size = 0;
        const chunks = yield* request.stream.pipe(
          Stream.mapEffect((chunk) => {
            size += chunk.byteLength;
            return size > REMOTE_CONTEXT_MAX_BODY_BYTES
              ? Effect.fail("too_large" as const)
              : Effect.succeed(chunk);
          }),
          Stream.runCollect,
          Effect.mapError(() => "too_large" as const),
        );
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        const result = yield* service.receive(token, new TextDecoder().decode(bytes));
        return HttpServerResponse.jsonUnsafe(result, { headers: { "cache-control": "no-store" } });
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(
            HttpServerResponse.jsonUnsafe(
              error === "too_large"
                ? { code: "payload_too_large" }
                : { _tag: error._tag, code: error.code, message: error.message },
              {
                status:
                  error === "too_large"
                    ? 413
                    : error.code === "capability_denied"
                      ? 403
                      : error.code === "orchestration_error"
                        ? 503
                        : 400,
              },
            ),
          ),
        ),
      ),
    );
  }),
);
