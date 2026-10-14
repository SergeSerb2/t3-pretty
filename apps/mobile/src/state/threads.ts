import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
  createThreadEnvironmentAtoms,
} from "@t3tools/client-runtime/state/threads";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { scopedThreadKey } from "../lib/scopedEntities";
import { automationEnvironment } from "./automations";
import { pendingThreadCreationOutcomesAtom } from "./pending-thread-creation";
import { environmentSnapshotAtom } from "./shell";
import { threadOutboxManager } from "./thread-outbox";

// Keep back-navigation warm without retaining every opened thread's WebSocket
// stream and full event history for the shared five-minute desktop TTL.
export const MOBILE_THREAD_STATE_IDLE_TTL_MS = 15_000;

export const threadEnvironment = createThreadEnvironmentAtoms(
  connectionAtomRuntime,
  environmentSnapshotAtom,
);
const liveEnvironmentThreads = createEnvironmentThreadStateAtoms(connectionAtomRuntime);
export const environmentThreadShells = createEnvironmentThreadShellAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: threadEnvironment.snapshotAtom,
  automationIndexAtom: automationEnvironment.automationIndexAtom,
});

const EMPTY_THREAD_STATE = AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE);
const EMPTY_THREAD_STATE_ATOM = Atom.make(EMPTY_THREAD_STATE).pipe(
  Atom.withLabel("mobile-environment-thread:empty"),
);

const threadStateAtomFamily = Atom.family((environmentId: EnvironmentId) =>
  Atom.family((threadId: ThreadId) =>
    Atom.make((get) => {
      const key = scopedThreadKey(environmentId, threadId);
      const queued = get(threadOutboxManager.queuedMessagesByThreadKeyAtom)[key];
      const outcome = get(pendingThreadCreationOutcomesAtom)[key];
      // Every detail selector can mount the stream, including model, queue,
      // and agent badges. Hold all of them until this local creation exists.
      if (
        outcome?.kind !== "delivered" &&
        (outcome?.kind === "failed" || queued?.some((message) => message.creation !== undefined)) &&
        get(environmentThreadShells.threadShellAtom({ environmentId, threadId })) === null
      ) {
        return EMPTY_THREAD_STATE;
      }
      return get(liveEnvironmentThreads.stateAtom(environmentId, threadId));
    }).pipe(
      Atom.setIdleTTL(0),
      Atom.withLabel(`mobile-environment-thread:${environmentId}:${threadId}`),
    ),
  ),
);

export const environmentThreads = {
  stateAtom: (environmentId: EnvironmentId, threadId: ThreadId) =>
    threadStateAtomFamily(environmentId)(threadId),
};
export const environmentThreadDetails = createEnvironmentThreadDetailAtoms(
  environmentThreads.stateAtom,
  { idleTtlMs: MOBILE_THREAD_STATE_IDLE_TTL_MS },
);

export function useEnvironmentThread(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): EnvironmentThreadState {
  const result = useAtomValue(
    environmentId !== null && threadId !== null
      ? environmentThreads.stateAtom(environmentId, threadId)
      : EMPTY_THREAD_STATE_ATOM,
  );
  const state = Option.getOrElse(
    AsyncResult.value(result),
    () => EMPTY_ENVIRONMENT_THREAD_STATE,
  ) as EnvironmentThreadState;
  return state;
}
