import {
  RelayApi,
  RelayEnvironmentPrincipal,
  RelayAuthInvalidError,
  RelayInternalError,
} from "@t3tools/contracts/relay";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";

import * as PeerAccess from "../environments/PeerAccess.ts";

const traceId = Effect.currentParentSpan.pipe(
  Effect.map((span) => span.traceId),
  Effect.orElseSucceed(() => "unavailable"),
);
const peerErrors = {
  PeerAccessDenied: () =>
    Effect.flatMap(traceId, (traceId) =>
      Effect.fail(
        new RelayAuthInvalidError({ code: "auth_invalid", reason: "not_authorized", traceId }),
      ),
    ),
  PeerAccessUnavailable: () =>
    Effect.flatMap(traceId, (traceId) =>
      Effect.fail(
        new RelayInternalError({ code: "internal_error", reason: "internal_error", traceId }),
      ),
    ),
};

export const layer = HttpApiBuilder.group(
  RelayApi,
  "peers",
  Effect.fnUntraced(function* (handlers) {
    const peers = yield* PeerAccess.PeerAccess;
    return handlers
      .handle("list", () =>
        Effect.flatMap(RelayEnvironmentPrincipal, (principal) => peers.list(principal)).pipe(
          Effect.catchTags(peerErrors),
        ),
      )
      .handle("authorize", ({ payload }) =>
        Effect.flatMap(RelayEnvironmentPrincipal, (principal) =>
          peers.authorize(principal, payload),
        ).pipe(Effect.catchTags(peerErrors)),
      );
  }),
).pipe(Layer.provide(PeerAccess.layer));
