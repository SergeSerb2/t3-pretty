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
      metadata.data?.find(
        (terminal) =>
          terminal.threadId === input.terminal?.threadId &&
          terminal.terminalId === input.terminal?.terminalId,
      ) ?? null;
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
  return useMemo(() => {
    if (input.environmentId === null) {
      return [];
    }
    return (metadata.data ?? [])
      .filter((summary) => input.threadId === null || summary.threadId === input.threadId)
      .map((summary) => ({
        target: {
          environmentId: input.environmentId!,
          threadId: ThreadId.make(summary.threadId),
          terminalId: summary.terminalId,
        },
        state: combineTerminalSessionState(summary, EMPTY_TERMINAL_BUFFER_STATE),
      }))
      .sort((left, right) =>
        left.target.terminalId.localeCompare(right.target.terminalId, undefined, {
          numeric: true,
        }),
      );
  }, [input.environmentId, input.threadId, metadata.data]);
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
