import {
  ProjectTransferError,
  WS_METHODS,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { Atom } from "effect/unstable/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { request } from "../rpc/client.ts";
import { createRuntimeCommand } from "./runtime.ts";

export interface ProjectTransferCommandInput {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly destinationEnvironmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

const destinationUnavailable = (detail: string) =>
  new ProjectTransferError({ reason: "destination_unavailable", detail });

export const transferProjectThread = Effect.fn("ProjectTransfer.transfer")(function* (
  input: ProjectTransferCommandInput,
) {
  if (input.sourceEnvironmentId === input.destinationEnvironmentId) {
    return yield* destinationUnavailable("Choose a different managed connection.");
  }

  const environments = yield* EnvironmentRegistry;
  const destination = (yield* SubscriptionRef.get(environments.entries)).get(
    input.destinationEnvironmentId,
  );
  if (destination?.target._tag !== "RelayConnectionTarget") {
    return yield* destinationUnavailable("The destination must be a managed connection.");
  }

  const { manifest } = yield* environments.run(
    input.sourceEnvironmentId,
    request(WS_METHODS.projectTransfersInspect, { threadId: input.threadId }),
  );
  const preparedConnection = yield* environments.run(
    input.destinationEnvironmentId,
    Effect.gen(function* () {
      const supervisor = yield* EnvironmentSupervisor;
      return yield* SubscriptionRef.get(supervisor.prepared);
    }),
  );
  if (Option.isNone(preparedConnection)) {
    return yield* destinationUnavailable("The destination connection is offline.");
  }

  const prepared = yield* environments.run(
    input.destinationEnvironmentId,
    request(WS_METHODS.projectTransfersPrepare, { manifest }),
  );
  const destinationUrl = environmentEndpointUrl(
    preparedConnection.value.httpBaseUrl,
    prepared.relativeUrl,
  );

  return yield* environments
    .run(
      input.sourceEnvironmentId,
      request(WS_METHODS.projectTransfersSend, {
        threadId: input.threadId,
        expectedUpdatedAt: manifest.thread.updatedAt,
        destinationUrl,
      }),
    )
    .pipe(
      Effect.onError(() =>
        environments
          .run(
            input.destinationEnvironmentId,
            request(WS_METHODS.projectTransfersCancel, { transferId: prepared.transferId }),
          )
          .pipe(Effect.ignore),
      ),
    );
});

export const createProjectTransferCommand = <R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) =>
  createRuntimeCommand(runtime, {
    label: "project-transfer:copy-thread",
    concurrency: {
      mode: "singleFlight",
      key: (input: ProjectTransferCommandInput) => `${input.sourceEnvironmentId}:${input.threadId}`,
    },
    execute: transferProjectThread,
  });
