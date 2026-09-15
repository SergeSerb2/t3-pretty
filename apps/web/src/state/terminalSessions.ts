import {
  combineTerminalSessionState,
  EMPTY_TERMINAL_BUFFER_STATE,
  EMPTY_TERMINAL_SESSION_STATE,
  type KnownTerminalSession,
  type TerminalSessionState,
} from "@t3tools/client-runtime/state/terminal";
import { useAtomValue } from "@effect/atom-react";
import {
  ThreadId,
  type EnvironmentId,
  type TerminalAttachInput,
  type TerminalSummary,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { useEnvironmentQuery } from "./query";
import { terminalEnvironment } from "./terminal";

const TERMINAL_SELECTOR_IDLE_TTL_MS = 5 * 60_000;
const EMPTY_RUNNING_TERMINAL_IDS: ReadonlyArray<string> = Object.freeze([]);
const EMPTY_RUNNING_TERMINAL_IDS_ATOM = Atom.make(EMPTY_RUNNING_TERMINAL_IDS).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-terminal:running-ids:empty"),
);

export function indexRunningTerminalIdsByThread(
  summaries: ReadonlyArray<TerminalSummary>,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const idsByThread = new Map<string, string[]>();
  for (const summary of summaries) {
    if (!summary.hasRunningSubprocess) continue;
    const ids = idsByThread.get(summary.threadId);
    if (ids) ids.push(summary.terminalId);
    else idsByThread.set(summary.threadId, [summary.terminalId]);
  }
  for (const ids of idsByThread.values()) {
    ids.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  }
  return idsByThread;
}

const runningTerminalIdsByEnvironmentAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const result = get(terminalEnvironment.metadata({ environmentId, input: null }));
    const summaries = Option.getOrElse(AsyncResult.value(result), () => []);
    return indexRunningTerminalIdsByThread(summaries);
  }).pipe(
    Atom.setIdleTTL(TERMINAL_SELECTOR_IDLE_TTL_MS),
    Atom.withLabel(`web-terminal:running-ids-by-thread:${environmentId}`),
  ),
);

function sameTerminalIds(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

const runningTerminalIdsByThreadAtom = Atom.family((key: string) => {
  const [environmentId, threadId] = JSON.parse(key) as [EnvironmentId, ThreadId];
  return Atom.make(
    (get): ReadonlyArray<string> =>
      get(runningTerminalIdsByEnvironmentAtom(environmentId)).get(threadId) ??
      EMPTY_RUNNING_TERMINAL_IDS,
  ).pipe(
    Atom.withEquality<ReadonlyArray<string>>(sameTerminalIds),
    Atom.setIdleTTL(TERMINAL_SELECTOR_IDLE_TTL_MS),
    Atom.withLabel(`web-terminal:running-ids:${key}`),
  );
});

const EMPTY_KNOWN_TERMINAL_SESSIONS = Object.freeze<ReadonlyArray<KnownTerminalSession>>([]);

interface TerminalMetadataIndex {
  readonly all: ReadonlyArray<TerminalSummary>;
  readonly byThreadId: ReadonlyMap<string, ReadonlyArray<TerminalSummary>>;
  readonly views: Map<EnvironmentId, Map<ThreadId | null, ReadonlyArray<KnownTerminalSession>>>;
}

const metadataIndexes = new WeakMap<ReadonlyArray<TerminalSummary>, TerminalMetadataIndex>();
const sessionsBySummary = new WeakMap<TerminalSummary, Map<EnvironmentId, KnownTerminalSession>>();
// Reuse groups a consumer still holds without keeping old group members alive
// merely because their first summary remains in a newer metadata snapshot.
const groupsByAnchor = new WeakMap<
  TerminalSummary,
  Map<
    EnvironmentId,
    {
      readonly all?: WeakRef<ReadonlyArray<KnownTerminalSession>>;
      readonly thread?: WeakRef<ReadonlyArray<KnownTerminalSession>>;
    }
  >
>();

function knownSession(
  summary: TerminalSummary,
  environmentId: EnvironmentId,
): KnownTerminalSession {
  let byEnvironment = sessionsBySummary.get(summary);
  const previous = byEnvironment?.get(environmentId);
  if (previous) return previous;
  const session = {
    target: {
      environmentId,
      threadId: ThreadId.make(summary.threadId),
      terminalId: summary.terminalId,
    },
    state: combineTerminalSessionState(summary, EMPTY_TERMINAL_BUFFER_STATE),
  };
  if (!byEnvironment) {
    byEnvironment = new Map();
    sessionsBySummary.set(summary, byEnvironment);
  }
  byEnvironment.set(environmentId, session);
  return session;
}

function terminalMetadataIndex(metadata: ReadonlyArray<TerminalSummary>): TerminalMetadataIndex {
  let index = metadataIndexes.get(metadata);
  if (!index) {
    const compare = new Intl.Collator(undefined, { numeric: true }).compare;
    const all = metadata.toSorted((left, right) => compare(left.terminalId, right.terminalId));
    const byThreadId = new Map<string, TerminalSummary[]>();
    for (const summary of all) {
      const group = byThreadId.get(summary.threadId);
      if (group) group.push(summary);
      else byThreadId.set(summary.threadId, [summary]);
    }
    index = { all, byThreadId, views: new Map() };
    metadataIndexes.set(metadata, index);
  }
  return index;
}

/** Share one ordered index per immutable snapshot without changing metadata subscriptions. */
export function selectKnownTerminalSessions(
  metadata: ReadonlyArray<TerminalSummary> | null,
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): ReadonlyArray<KnownTerminalSession> {
  if (environmentId === null || metadata === null || metadata.length === 0) {
    return EMPTY_KNOWN_TERMINAL_SESSIONS;
  }
  const index = terminalMetadataIndex(metadata);
  let views = index.views.get(environmentId);
  const cached = views?.get(threadId);
  if (cached) return cached;
  const summaries = threadId === null ? index.all : index.byThreadId.get(threadId);
  if (!summaries || summaries.length === 0) return EMPTY_KNOWN_TERMINAL_SESSIONS;

  const anchor = summaries[0]!;
  const kind = threadId === null ? "all" : "thread";
  let groups = groupsByAnchor.get(anchor);
  const previousGroups = groups?.get(environmentId);
  const previous = previousGroups?.[kind]?.deref();
  const sessions =
    previous?.length === summaries.length &&
    previous.every((session, index) => session.state.summary === summaries[index])
      ? previous
      : summaries.map((summary) => knownSession(summary, environmentId));
  if (!groups) {
    groups = new Map();
    groupsByAnchor.set(anchor, groups);
  }
  if (sessions !== previous) {
    groups.set(environmentId, { ...previousGroups, [kind]: new WeakRef(sessions) });
  }
  if (!views) {
    views = new Map();
    index.views.set(environmentId, views);
  }
  views.set(threadId, sessions);
  return sessions;
}

export function useAttachedTerminalSession(input: {
  readonly environmentId: EnvironmentId | null;
  readonly terminal: TerminalAttachInput | null;
}): TerminalSessionState {
  const attach = useEnvironmentQuery(
    input.environmentId !== null && input.terminal !== null
      ? terminalEnvironment.attach({
          environmentId: input.environmentId,
          input: input.terminal,
        })
      : null,
  );
  const metadata = useEnvironmentQuery(
    input.environmentId === null
      ? null
      : terminalEnvironment.metadata({
          environmentId: input.environmentId,
          input: null,
        }),
  );

  return useMemo(() => {
    if (input.environmentId === null || input.terminal === null) {
      return EMPTY_TERMINAL_SESSION_STATE;
    }
    const summary =
      (metadata.data === null
        ? null
        : terminalMetadataIndex(metadata.data)
            .byThreadId.get(input.terminal.threadId)
            ?.find((terminal) => terminal.terminalId === input.terminal?.terminalId)) ?? null;
    const state = combineTerminalSessionState(summary, attach.data ?? EMPTY_TERMINAL_BUFFER_STATE);
    return attach.error === null ? state : { ...state, error: attach.error, status: "error" };
  }, [attach.data, attach.error, input.environmentId, input.terminal, metadata.data]);
}

export function useKnownTerminalSessions(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<KnownTerminalSession> {
  const metadata = useEnvironmentQuery(
    input.environmentId === null
      ? null
      : terminalEnvironment.metadata({
          environmentId: input.environmentId,
          input: null,
        }),
  );
  return useMemo(
    () => selectKnownTerminalSessions(metadata.data, input.environmentId, input.threadId),
    [input.environmentId, input.threadId, metadata.data],
  );
}

export function useThreadRunningTerminalIds(input: {
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
}): ReadonlyArray<string> {
  return useAtomValue(
    input.environmentId === null || input.threadId === null
      ? EMPTY_RUNNING_TERMINAL_IDS_ATOM
      : runningTerminalIdsByThreadAtom(JSON.stringify([input.environmentId, input.threadId])),
  );
}
