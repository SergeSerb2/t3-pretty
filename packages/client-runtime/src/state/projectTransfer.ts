import {
  ProjectTransferError,
  WS_METHODS,
  type EnvironmentId,
  type ProjectTransferMode,
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

export type ProjectTransferStage = "inspecting" | "preparing" | "copying";

export interface ProjectTransferCommandInput {
  readonly sourceEnvironmentId: EnvironmentId;
  readonly destinationEnvironmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly mode: ProjectTransferMode;
  readonly onStage?: (stage: ProjectTransferStage) => void;
}

export function isProjectTransferThreadBusy(thread: {
  readonly latestTurn?: { readonly state?: string } | null;
  readonly session?: { readonly status?: string } | null;
  readonly hasPendingApprovals?: boolean;
  readonly hasPendingUserInput?: boolean;
}): boolean {
  return (
    thread.latestTurn?.state === "running" ||
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.hasPendingApprovals === true ||
    thread.hasPendingUserInput === true
  );
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

  input.onStage?.("inspecting");
  const { manifest } = yield* environments.run(
    input.sourceEnvironmentId,
    request(WS_METHODS.projectTransfersInspect, {
      threadId: input.threadId,
      mode: input.mode,
    }),
  );
  input.onStage?.("preparing");
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

  input.onStage?.("copying");
  return yield* environments
    .run(
      input.sourceEnvironmentId,
      request(WS_METHODS.projectTransfersSend, {
        threadId: input.threadId,
        expectedUpdatedAt: manifest.thread.updatedAt,
        destinationUrl,
        mode: input.mode,
        ...(input.mode === "move"
          ? {
              expectedThreadIds: [
                manifest.thread.id,
                ...(manifest.additionalThreads ?? []).map((thread) => thread.id),
              ],
            }
          : {}),
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
    label: "project-transfer:thread",
    concurrency: {
      mode: "singleFlight",
      key: (input: ProjectTransferCommandInput) => `${input.sourceEnvironmentId}:${input.threadId}`,
    },
    execute: transferProjectThread,
  });
