import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";

import { useThreadShell } from "./entities";
import { useOptimisticStartingThread } from "./optimistic-thread-send";
import { useEnvironmentThread } from "./threads";
import { useThreadSelection } from "./use-thread-selection";

export interface ThreadDetailTarget {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}

export function useThreadDetail(target: ThreadDetailTarget) {
  return useEnvironmentThread(target.environmentId, target.threadId);
}

export function useSelectedThreadDetailState() {
  const { selectedThread } = useThreadSelection();
  const selectedThreadRef =
    selectedThread === null
      ? null
      : { environmentId: selectedThread.environmentId, threadId: selectedThread.id };
  const serverShell = useThreadShell(selectedThreadRef);
  const localStarting = useOptimisticStartingThread({
    environmentId: selectedThread?.environmentId ?? null,
    threadId: selectedThread?.id ?? null,
  });
  // subscribeThread 404s until create lands. Hold the stream until the
  // server shell exists so a starting overlay is not mistaken for a deletion.
  const waitForServerThread = localStarting !== null && serverShell === null;
  return useThreadDetail({
    environmentId: waitForServerThread ? null : (selectedThread?.environmentId ?? null),
    threadId: waitForServerThread ? null : (selectedThread?.id ?? null),
  });
}

export function useSelectedThreadDetail() {
  return Option.getOrNull(useSelectedThreadDetailState().data);
}
