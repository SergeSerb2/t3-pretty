import type {
  AutomationId,
  AutomationShell,
  EnvironmentId,
  OrchestrationShellSnapshot,
  OrchestrationThreadShell,
  ProjectId,
  ScopedProjectRef,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { isAutomationRunThread } from "./automations.ts";
import type { EnvironmentThreadShell } from "./models.ts";
import { scopeThreadShell } from "./models.ts";
import type { EnvironmentCatalogState } from "./connections.ts";
import {
  arrayElementsEqual,
  parseProjectRefCollectionKey,
  parseThreadKey,
  projectRefCollectionKey,
  threadKey,
  threadRefsEqual,
} from "./entities.ts";

const EMPTY_THREADS: ReadonlyArray<OrchestrationThreadShell> = Object.freeze([]);
const EMPTY_SCOPED_THREAD_REFS: ReadonlyArray<ScopedThreadRef> = Object.freeze([]);
const EMPTY_THREAD_INDEX: ReadonlyMap<ThreadId, OrchestrationThreadShell> = new Map();
const EMPTY_THREAD_REFS_BY_PROJECT: ReadonlyMap<
  ProjectId,
  ReadonlyArray<ScopedThreadRef>
> = new Map();
const EMPTY_AUTOMATION_INDEX: ReadonlyMap<AutomationId, AutomationShell> = new Map();

export function createEnvironmentThreadShellAtoms(input: {
  readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  readonly snapshotAtom: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<OrchestrationShellSnapshot | null>;
  /**
   * Automation rows of the environment. Supplied by both apps; without it
   * nothing is an automation run thread and every list stays unfiltered.
   */
  readonly automationIndexAtom?: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<ReadonlyMap<AutomationId, AutomationShell>>;
}) {
  // Point reads and aggregate lists share values without keeping an atom alive
  // for every listed thread. Replaced source objects can be collected.
  const scopedThreads = new WeakMap<
    OrchestrationThreadShell,
    Map<EnvironmentId, EnvironmentThreadShell>
  >();
  const scopedThread = (environmentId: EnvironmentId, thread: OrchestrationThreadShell) => {
    let byEnvironment = scopedThreads.get(thread);
    if (byEnvironment === undefined) {
      byEnvironment = new Map();
      scopedThreads.set(thread, byEnvironment);
    }
    let value = byEnvironment.get(environmentId);
    if (value === undefined) {
      value = scopeThreadShell(environmentId, thread);
      byEnvironment.set(environmentId, value);
    }
    return value;
  };

  const environmentAllThreadsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): ReadonlyArray<OrchestrationThreadShell> =>
        get(input.snapshotAtom(environmentId))?.threads ?? EMPTY_THREADS,
    ).pipe(Atom.withLabel(`environment-all-threads:${environmentId}`)),
  );

  // Automation run threads are hidden from every thread list once, here, so no
  // surface has to remember to filter. Point reads keep resolving them: the
  // automation page opens a run thread by id.
  const environmentThreadsAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyArray<OrchestrationThreadShell> = EMPTY_THREADS;
    return Atom.make((get): ReadonlyArray<OrchestrationThreadShell> => {
      const threads = get(environmentAllThreadsAtom(environmentId));
      const automations =
        input.automationIndexAtom === undefined
          ? EMPTY_AUTOMATION_INDEX
          : get(input.automationIndexAtom(environmentId));
      if (automations.size === 0) {
        return threads;
      }
      const next = threads.filter((thread) => !isAutomationRunThread(thread, automations));
      if (next.length === threads.length) {
        return threads;
      }
      if (arrayElementsEqual(previous, next)) {
        return previous;
      }
      previous = next;
      return previous;
    }).pipe(Atom.withLabel(`environment-threads:${environmentId}`));
  });

  const environmentThreadIndexAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ReadonlyMap<ThreadId, OrchestrationThreadShell> => {
      const threads = get(environmentAllThreadsAtom(environmentId));
      if (threads.length === 0) {
        return EMPTY_THREAD_INDEX;
      }
      const index = new Map<ThreadId, OrchestrationThreadShell>();
      for (const thread of threads) {
        index.set(thread.id, thread);
      }
      return index;
    }).pipe(Atom.withLabel(`environment-thread-index:${environmentId}`)),
  );

  const environmentThreadRefsAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyArray<ScopedThreadRef> = [];
    return Atom.make((get) => {
      const next = get(environmentThreadsAtom(environmentId)).map((thread) => ({
        environmentId,
        threadId: thread.id,
      }));
      if (threadRefsEqual(previous, next)) {
        return previous;
      }
      previous = next;
      return next;
    }).pipe(Atom.withLabel(`environment-thread-refs:${environmentId}`));
  });

  const environmentThreadRefsByProjectAtom = Atom.family((environmentId: EnvironmentId) => {
    let previous: ReadonlyMap<
      ProjectId,
      ReadonlyArray<ScopedThreadRef>
    > = EMPTY_THREAD_REFS_BY_PROJECT;
    return Atom.make((get) => {
      const grouped = new Map<ProjectId, ScopedThreadRef[]>();
      for (const thread of get(environmentThreadsAtom(environmentId))) {
        const refs = grouped.get(thread.projectId);
        const ref = { environmentId, threadId: thread.id };
        if (refs === undefined) {
          grouped.set(thread.projectId, [ref]);
        } else {
          refs.push(ref);
        }
      }
      if (grouped.size === 0) {
        previous = EMPTY_THREAD_REFS_BY_PROJECT;
        return previous;
      }
      const next = new Map<ProjectId, ReadonlyArray<ScopedThreadRef>>();
      for (const [projectId, refs] of grouped) {
        const previousRefs = previous.get(projectId);
        next.set(
          projectId,
          previousRefs !== undefined && threadRefsEqual(previousRefs, refs) ? previousRefs : refs,
        );
      }
      const previousProjectIds = [...previous.keys()];
      if (
        next.size === previous.size &&
        [...next].every(
          ([projectId, refs], index) =>
            previousProjectIds[index] === projectId && previous.get(projectId) === refs,
        )
      ) {
        return previous;
      }
      previous = next;
      return previous;
    }).pipe(Atom.withLabel(`environment-thread-refs-by-project:${environmentId}`));
  });

  const threadShellAtomFamily = Atom.family((key: string) => {
    const ref = parseThreadKey(key);
    return Atom.make((get) => {
      const source = get(environmentThreadIndexAtom(ref.environmentId)).get(ref.threadId) ?? null;
      return source === null ? null : scopedThread(ref.environmentId, source);
    }).pipe(Atom.withLabel(`environment-thread-shell:${key}`));
  });

  const threadShellsForProjectRefsAtomFamily = Atom.family((key: string) => {
    const projectRefs = parseProjectRefCollectionKey(key);
    let previous: ReadonlyArray<EnvironmentThreadShell> = [];
    return Atom.make((get) => {
      const next: EnvironmentThreadShell[] = [];
      const seen = new Set<string>();
      for (const projectRef of projectRefs) {
        const refs =
          get(environmentThreadRefsByProjectAtom(projectRef.environmentId)).get(
            projectRef.projectId,
          ) ?? EMPTY_SCOPED_THREAD_REFS;
        if (refs.length === 0) continue;
        const threads = get(environmentThreadIndexAtom(projectRef.environmentId));
        for (const ref of refs) {
          const key = threadKey(ref);
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          const thread = threads.get(ref.threadId);
          if (thread !== undefined) {
            next.push(scopedThread(ref.environmentId, thread));
          }
        }
      }
      if (arrayElementsEqual(previous, next)) {
        return previous;
      }
      previous = next;
      return previous;
    }).pipe(Atom.withLabel(`environment-thread-shells-for-projects:${key}`));
  });

  let previousThreadRefs: ReadonlyArray<ScopedThreadRef> = [];
  const threadRefsAtom = Atom.make((get) => {
    const refs: ScopedThreadRef[] = [];
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      for (const ref of get(environmentThreadRefsAtom(environmentId))) {
        refs.push(ref);
      }
    }
    if (threadRefsEqual(previousThreadRefs, refs)) {
      return previousThreadRefs;
    }
    previousThreadRefs = refs;
    return refs;
  }).pipe(Atom.withLabel("environment-thread-refs"));

  const threadShellListAtom = (
    threadsAtom: (
      environmentId: EnvironmentId,
    ) => Atom.Atom<ReadonlyArray<OrchestrationThreadShell>>,
    label: string,
  ) => {
    let previous: ReadonlyArray<EnvironmentThreadShell> = [];
    return Atom.make((get) => {
      const next: EnvironmentThreadShell[] = [];
      for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
        for (const thread of get(threadsAtom(environmentId))) {
          next.push(scopedThread(environmentId, thread));
        }
      }
      if (arrayElementsEqual(previous, next)) {
        return previous;
      }
      previous = next;
      return previous;
    }).pipe(Atom.withLabel(label));
  };

  const threadShellsAtom = threadShellListAtom(
    environmentThreadsAtom,
    "environment-thread-shell-list",
  );
  /** Includes automation run threads; only the automation surfaces want this. */
  const allThreadShellsAtom = threadShellListAtom(
    environmentAllThreadsAtom,
    "environment-all-thread-shell-list",
  );

  return {
    environmentAllThreadsAtom,
    environmentThreadsAtom,
    environmentThreadIndexAtom,
    environmentThreadRefsAtom,
    environmentThreadRefsByProjectAtom,
    threadRefsAtom,
    threadShellsAtom,
    allThreadShellsAtom,
    threadShellsForProjectRefsAtom: (refs: ReadonlyArray<ScopedProjectRef>) =>
      threadShellsForProjectRefsAtomFamily(projectRefCollectionKey(refs)),
    threadShellAtom: (ref: ScopedThreadRef) => threadShellAtomFamily(threadKey(ref)),
  };
}
