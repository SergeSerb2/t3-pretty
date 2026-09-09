import { useRoute, type RouteProp } from "@react-navigation/native";
import { useMemo, useRef } from "react";
import {
  EnvironmentId,
  ThreadId,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Option from "effect/Option";

import { useProject, useThreadShell } from "../state/entities";
import { useEnvironmentThread } from "../state/threads";
import {
  useRemoteEnvironmentRuntime,
  useSavedRemoteConnection,
} from "./use-remote-environment-registry";
import { useOptimisticStartingThreadShell } from "./optimistic-thread-send";
import {
  resolveSelectedThreadShell,
  resolveSelectionDetailFallbackRef,
} from "./use-thread-selection.logic";
type ThreadSelectionRouteParams = {
  readonly environmentId?: string | string[];
  readonly threadId?: string | string[];
};

function firstRouteParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

<<<<<<< HEAD
=======
function latestUserMessageAt(thread: OrchestrationThread): OrchestrationThread["updatedAt"] | null {
  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (message?.role === "user") {
      return message.createdAt;
    }
  }

  return null;
}

function threadDetailToShell(
  environmentId: EnvironmentId,
  thread: OrchestrationThread,
): EnvironmentThreadShell {
  return {
    environmentId,
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    modelSelection: thread.modelSelection,
    runtimeMode: thread.runtimeMode,
    interactionMode: thread.interactionMode,
    branch: thread.branch,
    worktreePath: thread.worktreePath,
    linkedPullRequest: thread.linkedPullRequest ?? null,
    branchPullRequest: thread.branchPullRequest ?? null,
    latestTurn: thread.latestTurn,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    archivedAt: thread.archivedAt,
    settledOverride: thread.settledOverride,
    settledAt: thread.settledAt,
    unsettledAt: thread.unsettledAt,
    activeOrderKey: thread.activeOrderKey,
    pinnedAt: thread.pinnedAt,
    pinOrderKey: thread.pinOrderKey,
    snoozedUntil: thread.snoozedUntil ?? null,
    snoozedAt: thread.snoozedAt ?? null,
    session: thread.session,
    latestUserMessageAt: latestUserMessageAt(thread),
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

>>>>>>> v0.0.39-nightly.20260907.1332
function useResolvedThreadSelection(params: ThreadSelectionRouteParams | undefined) {
  const routeParams = params ?? {};
  const routeThreadRef = useMemo<ScopedThreadRef | null>(() => {
    const environmentId = firstRouteParam(routeParams.environmentId);
    const threadId = firstRouteParam(routeParams.threadId);
    if (!environmentId || !threadId) {
      return null;
    }

    return {
      environmentId: EnvironmentId.make(environmentId),
      threadId: ThreadId.make(threadId),
    };
  }, [routeParams.environmentId, routeParams.threadId]);
  const lastRouteThreadRef = useRef<ScopedThreadRef | null>(null);
  if (routeThreadRef !== null) {
    lastRouteThreadRef.current = routeThreadRef;
  }
  const selectedThreadRef = routeThreadRef ?? lastRouteThreadRef.current;
  const selectedThreadShell = useThreadShell(selectedThreadRef);
  const localStartingShell = useOptimisticStartingThreadShell({
    environmentId: selectedThreadRef?.environmentId ?? null,
    threadId: selectedThreadRef?.threadId ?? null,
  });
  // The shell snapshot is authoritative for selection metadata. Only fall back
  // to the hot per-thread detail stream while the shell cannot identify the
  // thread, so consumers do not re-render at stream rate during active turns.
  // A local starting overlay is enough to render the thread chrome, so skip
  // the missing-thread subscribe until the server lists it.
  const detailFallbackRef = resolveSelectionDetailFallbackRef(
    selectedThreadRef,
    selectedThreadShell,
    localStartingShell !== null,
  );
  const selectedThreadDetailState = useEnvironmentThread(
    detailFallbackRef?.environmentId ?? null,
    detailFallbackRef?.threadId ?? null,
  );
  const selectedThreadDetail = Option.getOrNull(selectedThreadDetailState.data);
  const selectedThread = useMemo(() => {
    const resolvedThread = resolveSelectedThreadShell(
      selectedThreadRef,
      selectedThreadShell,
      selectedThreadDetail,
      localStartingShell,
    );
    if (resolvedThread === null || detailFallbackRef === null || selectedThreadDetail === null) {
      return resolvedThread;
    }

    return {
      ...resolvedThread,
      linkedPullRequest: selectedThreadDetail.linkedPullRequest ?? null,
    };
  }, [
    detailFallbackRef,
    localStartingShell,
    selectedThreadDetail,
    selectedThreadRef,
    selectedThreadShell,
  ]);
  const selectedProjectRef = useMemo<ScopedProjectRef | null>(
    () =>
      selectedThread === null
        ? null
        : {
            environmentId: selectedThread.environmentId,
            projectId: selectedThread.projectId,
          },
    [selectedThread],
  );
  const selectedThreadProject = useProject(selectedProjectRef);
  const selectedEnvironmentId = selectedThread?.environmentId ?? null;
  const selectedEnvironmentConnection = useSavedRemoteConnection(selectedEnvironmentId);
  const selectedEnvironmentRuntime = useRemoteEnvironmentRuntime(selectedEnvironmentId);

  return useMemo(
    () => ({
      selectedThreadRef,
      selectedThread,
      selectedThreadProject,
      selectedEnvironmentConnection,
      selectedEnvironmentRuntime,
    }),
    [
      selectedEnvironmentConnection,
      selectedEnvironmentRuntime,
      selectedThread,
      selectedThreadProject,
      selectedThreadRef,
    ],
  );
}

type ThreadSelectionState = ReturnType<typeof useResolvedThreadSelection>;

export function useThreadSelection(): ThreadSelectionState {
  const route = useRoute<RouteProp<Record<string, ThreadSelectionRouteParams | undefined>>>();
  return useResolvedThreadSelection(route.params);
}
