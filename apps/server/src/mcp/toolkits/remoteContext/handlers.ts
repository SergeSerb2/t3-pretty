import * as Effect from "effect/Effect";
import * as RemoteContext from "../../../relay/RemoteContext.ts";
import * as McpContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { RemoteContextToolkit } from "./tools.ts";

export const layer = McpToolAccess.toLayer(RemoteContextToolkit, {
  t3_remote_connections: McpToolAccess.readsAsCaller(() =>
    Effect.gen(function* () {
      return yield* (yield* RemoteContext.RemoteContext).peers(
        yield* McpContext.McpInvocationContext,
      );
    }),
  ),
  t3_remote_threads: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      return yield* (yield* RemoteContext.RemoteContext).search(
        yield* McpContext.McpInvocationContext,
        { ...input, query: input.query ?? "" },
      );
    }),
  ),
  t3_remote_send: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      return yield* (yield* RemoteContext.RemoteContext).send(
        yield* McpContext.McpInvocationContext,
        input,
      );
    }),
  ),
});
