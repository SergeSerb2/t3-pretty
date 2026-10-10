import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentAutomation,
  ScopedAutomationRef,
} from "@t3tools/client-runtime/state/automations";
import type {
  EnvironmentProject,
  EnvironmentThread,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  environmentMachineKey,
  resolveWritableThreadEnvironmentId,
} from "@t3tools/client-runtime/state/thread-environment-target";
import {
  EMPTY_THREAD_HISTORY_META,
  type EnvironmentThreadStatus,
  type ThreadHistoryMeta,
} from "@t3tools/client-runtime/state/threads";
import type { ScopedProjectRef, ScopedThreadRef, ServerConfig } from "@t3tools/contracts";
import type { EnvironmentId, OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { automationEnvironment } from "./automations";
import { environmentPresentations } from "./presentation";
import { environmentProjects } from "./projects";
import { environmentServerConfigsAtom } from "./server";
import {
  allEnvironmentProjectSnapshotsReadyAtom,
  allEnvironmentShellsBootstrappedAtom,
} from "./shell";
import { environmentThreadDetails, environmentThreadShells } from "./threads";
import { waitForAtomValue } from "./waitForAtomValue";

const EMPTY_THREAD_REFS: ReadonlyArray<ScopedThreadRef> = Object.freeze([]);
const EMPTY_VISIBLE_TURN_ITEMS: ReadonlyArray<OrchestrationV2ProjectedTurnItem> = Object.freeze([]);

const EMPTY_AUTOMATION_ATOM = Atom.make<EnvironmentAutomation | null>(null).pipe(
  Atom.withLabel("web-automation:empty"),
);
const EMPTY_PROJECT_ATOM = Atom.make<EnvironmentProject | null>(null).pipe(
  Atom.withLabel("web-project:empty"),
);
const EMPTY_THREAD_REFS_ATOM = Atom.make(EMPTY_THREAD_REFS).pipe(
  Atom.withLabel("web-thread-refs:empty"),
);
const EMPTY_THREAD_SHELLS_ATOM = Atom.make<ReadonlyArray<EnvironmentThreadShell>>(
  Object.freeze([]),
).pipe(Atom.withLabel("web-thread-shells:empty"));
const EMPTY_THREAD_SHELL_ATOM = Atom.make<EnvironmentThreadShell | null>(null).pipe(
  Atom.withLabel("web-thread-shell:empty"),
);
const EMPTY_THREAD_PROJECTION_ATOM = Atom.make<EnvironmentThread | null>(null).pipe(
  Atom.withLabel("web-thread-projection:empty"),
);
const EMPTY_THREAD_STATUS_ATOM = Atom.make<EnvironmentThreadStatus>("empty").pipe(
  Atom.withLabel("web-thread-status:empty"),
);
const EMPTY_VISIBLE_TURN_ITEMS_ATOM = Atom.make(EMPTY_VISIBLE_TURN_ITEMS).pipe(
  Atom.withLabel("web-thread-visible-turn-items:empty"),
);
const EMPTY_THREAD_HISTORY_ATOM = Atom.make<ThreadHistoryMeta>(EMPTY_THREAD_HISTORY_META).pipe(
  Atom.withLabel("web-thread-history:empty"),
);

const activeEnvironmentIdAtom = Atom.make<EnvironmentId | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-active-environment-id"),
);

export function useActiveEnvironmentId(): EnvironmentId | null {
  return useAtomValue(activeEnvironmentIdAtom);
}

export function setActiveEnvironmentId(environmentId: EnvironmentId | null): void {
  appAtomRegistry.set(activeEnvironmentIdAtom, environmentId);
}

export function useThreadRefs(): ReadonlyArray<ScopedThreadRef> {
  return useAtomValue(environmentThreadShells.threadRefsAtom);
}

export function useEnvironmentThreadRefs(
  environmentId: EnvironmentId | null,
): ReadonlyArray<ScopedThreadRef> {
  return useAtomValue(
    environmentId === null
      ? EMPTY_THREAD_REFS_ATOM
      : environmentThreadShells.environmentThreadRefsAtom(environmentId),
  );
}

export function useProjects(): ReadonlyArray<EnvironmentProject> {
  return useAtomValue(environmentProjects.projectsAtom);
}

export function useServerConfigs(): ReadonlyMap<EnvironmentId, ServerConfig> {
  return useAtomValue(environmentServerConfigsAtom);
}

/** Every thread shell. Pass `enabled: false` to read a stable empty list and
    skip re-rendering on each shell update while the caller does not need them. */
export function useThreadShells(enabled = true): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(
    enabled ? environmentThreadShells.threadShellsAtom : EMPTY_THREAD_SHELLS_ATOM,
  );
}

export function useAllEnvironmentShellsBootstrapped(): boolean {
  return useAtomValue(allEnvironmentShellsBootstrappedAtom);
}

export function useAllEnvironmentProjectSnapshotsReady(): boolean {
  return useAtomValue(allEnvironmentProjectSnapshotsReadyAtom);
}

export function useThreadShellsForProjectRefs(
  refs: ReadonlyArray<ScopedProjectRef>,
): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(environmentThreadShells.threadShellsForProjectRefsAtom(refs));
}

export function useProject(ref: ScopedProjectRef | null): EnvironmentProject | null {
  return useAtomValue(ref === null ? EMPTY_PROJECT_ATOM : environmentProjects.projectAtom(ref));
}

export function useAutomationShell(ref: ScopedAutomationRef | null): EnvironmentAutomation | null {
  return useAtomValue(
    ref === null ? EMPTY_AUTOMATION_ATOM : automationEnvironment.automationShellAtom(ref),
  );
}

export function useThreadShell(ref: ScopedThreadRef | null): EnvironmentThreadShell | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_SHELL_ATOM : environmentThreadShells.threadShellAtom(ref),
  );
}

export function useChildThreadInputs(ref: ScopedThreadRef | null) {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_SHELLS_ATOM : environmentThreadShells.childThreadInputsAtom(ref),
  );
}

export function useThreadProjection(ref: ScopedThreadRef | null): EnvironmentThread | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_PROJECTION_ATOM : environmentThreadDetails.threadAtom(ref),
  );
}

export function readThreadDetail(ref: ScopedThreadRef): EnvironmentThread | null {
  const atom = environmentThreadDetails.threadAtom(ref);
  const result = appAtomRegistry.get(atom);
  return result ?? null;
}

export function useThreadStatus(ref: ScopedThreadRef | null): EnvironmentThreadStatus {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_STATUS_ATOM : environmentThreadDetails.statusAtom(ref),
  );
}

export function useThreadHistory(ref: ScopedThreadRef | null): ThreadHistoryMeta {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_HISTORY_ATOM : environmentThreadDetails.historyAtom(ref),
  );
}

export function resolveThreadDetailRef(
  ref: ScopedThreadRef | null,
  options: {
    shellExists: boolean;
    waitForShell: boolean;
  },
): ScopedThreadRef | null {
  return ref !== null && (!options.waitForShell || options.shellExists) ? ref : null;
}

export function useThreadVisibleTurnItems(
  ref: ScopedThreadRef | null,
): ReadonlyArray<OrchestrationV2ProjectedTurnItem> {
  return useAtomValue(
    ref === null
      ? EMPTY_VISIBLE_TURN_ITEMS_ATOM
      : environmentThreadDetails.visibleTurnItemsAtom(ref),
  );
}

export function readProject(ref: ScopedProjectRef): EnvironmentProject | null {
  return appAtomRegistry.get(environmentProjects.projectAtom(ref));
}

export function readProjects(): ReadonlyArray<EnvironmentProject> {
  return appAtomRegistry.get(environmentProjects.projectsAtom);
}

/** Resolves when the project event reaches the live client store. */
export function waitForProject(
  ref: ScopedProjectRef,
  timeoutMs = 10_000,
): Promise<EnvironmentProject> {
  const current = readProject(ref);
  if (current !== null) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;
    const timeout = setTimeout(() => {
      unsubscribe?.();
      reject(new Error("The project did not appear in the desktop app."));
    }, timeoutMs);
    const finish = (project: EnvironmentProject | null) => {
      if (project === null) return;
      clearTimeout(timeout);
      unsubscribe?.();
      resolve(project);
    };
    unsubscribe = appAtomRegistry.subscribe(environmentProjects.projectAtom(ref), finish);
    finish(readProject(ref));
  });
}

export function readThreadShell(ref: ScopedThreadRef): EnvironmentThreadShell | null {
  return appAtomRegistry.get(environmentThreadShells.threadShellAtom(ref));
}

export function waitForThreadShell(ref: ScopedThreadRef, timeoutMs = 5_000): Promise<boolean> {
  return waitForAtomValue({
    registry: appAtomRegistry,
    atom: environmentThreadShells.threadShellAtom(ref),
    predicate: (thread) => thread !== null,
    timeoutMs,
  });
}

/** Whether the environment hosts preview tabs in its own browser (`runtime: "server"`),
    so clients without Electron can still use the Browser panel. */
export function useEnvironmentSupportsServerBrowser(environmentId: EnvironmentId | null): boolean {
  const configs = useServerConfigs();
  return (
    environmentId !== null &&
    configs.get(environmentId)?.environment.capabilities.serverBrowser === true
  );
}

export function readEnvironmentSupportsServerBrowser(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .serverBrowser === true
  );
}

export function readEnvironmentSupportsTitleRegeneration(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadTitleRegeneration === true
  );
}

/** Whether the environment's server understands thread.store/unstore.
    Same version-skew contract as settlement. */
export function readEnvironmentSupportsStorage(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadStorage === true
  );
}

/** Whether the environment's server understands thread.pin/unpin.
    Same version-skew contract as settlement. */
export function readEnvironmentSupportsPinning(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadPinning === true
  );
}

/** Whether the environment's server understands thread.pin.reorder (and
    orderKey on thread.pin). Same version-skew contract as settlement. */
export function readEnvironmentSupportsPinReorder(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadPinReorder === true
  );
}

/** Whether the environment's server understands thread.auto-settle.set.
    Same version-skew contract as settlement. */
export function readEnvironmentSupportsAutoSettleOptOut(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadAutoSettleOptOut === true
  );
}

export function readEnvironmentSupportsActiveReorder(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadActiveReorder === true
  );
}

/** Whether the environment's server understands thread.settle/unsettle.
    False for pre-settlement servers (capability defaults false on decode),
    so clients under version skew fall back instead of erroring. */
export function readEnvironmentSupportsSettlement(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadSettlement === true
  );
}

/** Whether the environment's server understands thread.snooze/unsnooze.
    Same version-skew contract as settlement. */
export function readEnvironmentSupportsSnooze(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadSnooze === true
  );
}

/** Whether the environment's server understands thread.visit/mark-unread and
    projects lastVisitedAt on thread shells. Same version-skew contract as
    settlement: against older servers, clients keep the browser-local visited
    state instead. */
export function readEnvironmentSupportsVisitedTracking(environmentId: EnvironmentId): boolean {
  return (
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.environment.capabilities
      .threadVisitedTracking === true
  );
}

export function readEnvironmentThreadRefs(
  environmentId: EnvironmentId,
): ReadonlyArray<ScopedThreadRef> {
  return appAtomRegistry.get(environmentThreadShells.environmentThreadRefsAtom(environmentId));
}

export function readThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  return appAtomRegistry.get(environmentThreadShells.threadShellsAtom);
}

/** Live connection that can accept a command for this thread, if one exists. */
export function readWritableThreadRef(target: ScopedThreadRef): ScopedThreadRef {
  const presentations = appAtomRegistry.get(environmentPresentations.presentationsAtom);
  const threadIdsByEnvironment = new Map<EnvironmentId, Set<ScopedThreadRef["threadId"]>>();
  for (const shell of readThreadShells()) {
    const threadIds = threadIdsByEnvironment.get(shell.environmentId);
    if (threadIds === undefined) {
      threadIdsByEnvironment.set(shell.environmentId, new Set([shell.id]));
    } else {
      threadIds.add(shell.id);
    }
  }
  const environmentId = resolveWritableThreadEnvironmentId({
    environmentId: target.environmentId,
    threadId: target.threadId,
    candidates: [...presentations.entries()].map(([id, presentation]) => ({
      environmentId: id,
      connected: presentation.connection.phase === "connected",
      machineKey: environmentMachineKey(presentation.entry.target.label),
      threadIds: threadIdsByEnvironment.get(id) ?? new Set(),
    })),
  });
  return environmentId === target.environmentId
    ? target
    : scopeThreadRef(environmentId, target.threadId);
}
