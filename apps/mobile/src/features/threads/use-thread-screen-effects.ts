import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { useContext, useEffect, useRef } from "react";
import { AppState } from "react-native";

import { hapticError, hapticSuccess, hapticWarning } from "../../lib/haptics";
import type { ThreadFeedEntry } from "../../lib/threadActivity";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { NativeWorkspaceTabActivityContext } from "../../native/v5-workspace-context";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

function latestStreamingAssistantMessage(feed: ReadonlyArray<ThreadFeedEntry>) {
  for (let index = feed.length - 1; index >= 0; index--) {
    const entry = feed[index]!;
    if (entry.type === "message" && entry.message.role === "assistant" && entry.message.streaming) {
      return { id: entry.message.id, textLength: entry.message.text.length };
    }
  }
  return null;
}

export interface ThreadMoment {
  readonly runId: string | null;
  readonly status: string | null;
  readonly needsInput: boolean;
}

// Preparing is left out: a cancelled worktree setup fails the run, and the
// cancel tap already gave feedback.
const ACTIVE_RUN_STATUSES = new Set(["queued", "starting", "running", "waiting"]);
// An agent asking again right after the user answered reads as a double buzz.
const FOLLOW_UP_REQUEST_QUIET_MS = 2_000;

/**
 * The haptic for a change the user watched happen on the open thread: the
 * agent asking for input, or the turn they were waiting on finishing. An
 * interrupt is silent here because the stop tap already gave feedback.
 */
export function threadMomentHaptic(
  previous: ThreadMoment,
  next: ThreadMoment,
): "success" | "warning" | "error" | null {
  if (next.needsInput && !previous.needsInput) return "warning";
  if (previous.runId === null || previous.runId !== next.runId) return null;
  if (previous.status === null || !ACTIVE_RUN_STATUSES.has(previous.status)) return null;
  if (next.status === "completed") return "success";
  if (next.status === "failed") return "error";
  return null;
}

export function useThreadScreenEffects(input: {
  readonly environmentId: EnvironmentId;
  readonly selectedThread: EnvironmentThreadShell;
  readonly feed: ReadonlyArray<ThreadFeedEntry>;
  readonly visible: boolean;
}) {
  const { environmentId, selectedThread, feed, visible } = input;
  const tabActivity = useContext(NativeWorkspaceTabActivityContext);
  const threadId = selectedThread.id;
  const threadKey = scopedThreadKey(environmentId, threadId);
  const lastStreaming = useRef<ReturnType<typeof latestStreamingAssistantMessage>>(null);
  const lastStreamHapticAt = useRef(0);
  const hydrated = useRef(false);
  const previousThreadKey = useRef(threadKey);

  useEffect(() => {
    const latest = latestStreamingAssistantMessage(feed);
    if (previousThreadKey.current !== threadKey) {
      previousThreadKey.current = threadKey;
      hydrated.current = false;
    }
    if (!visible || AppState.currentState !== "active" || tabActivity?.isActive() === false) {
      hydrated.current = false;
      lastStreaming.current = latest;
      return;
    }
    // Returning to a retained route seeds the current stream without a catch-up buzz.
    if (!hydrated.current) {
      hydrated.current = true;
      lastStreaming.current = latest;
      return;
    }
    const previous = lastStreaming.current;
    lastStreaming.current = latest;
    if (!latest) return;
    const isNewStream = previous?.id !== latest.id;
    const textGrew = previous?.id === latest.id && latest.textLength > previous.textLength;
    if (!isNewStream && !textGrew) return;
    const now = Date.now();
    if (!isNewStream && now - lastStreamHapticAt.current < 320) return;
    lastStreamHapticAt.current = now;
    void Haptics.selectionAsync();
  }, [feed, tabActivity, threadKey, visible]);

  const runId = selectedThread.latestRun?.runId ?? null;
  const runStatus = selectedThread.latestRun?.status ?? null;
  const needsInput = selectedThread.hasPendingApprovals || selectedThread.hasPendingUserInput;
  const inputAnsweredAt = useRef(0);
  const lastMoment = useRef<{ readonly threadKey: string; readonly moment: ThreadMoment } | null>(
    null,
  );
  useEffect(() => {
    const moment = { runId, status: runStatus, needsInput };
    const previous = lastMoment.current;
    if (!visible || AppState.currentState !== "active" || tabActivity?.isActive() === false) {
      lastMoment.current = null;
      return;
    }
    lastMoment.current = { threadKey, moment };
    if (previous === null || previous.threadKey !== threadKey) return;
    const now = Date.now();
    if (previous.moment.needsInput && !needsInput) inputAnsweredAt.current = now;
    const haptic = threadMomentHaptic(previous.moment, moment);
    if (haptic === "success") hapticSuccess();
    else if (haptic === "error") hapticError();
    else if (haptic === "warning" && now - inputAnsweredAt.current >= FOLLOW_UP_REQUEST_QUIET_MS) {
      hapticWarning();
    }
  }, [needsInput, runId, runStatus, tabActivity, threadKey, visible]);

  const visitThread = useAtomCommand(threadEnvironment.visit, { reportFailure: false });
  const lastDispatched = useRef<string | null>(null);
  const lastDispatch = useRef({ threadKey, at: 0 });
  const updatedAt = selectedThread.updatedAt;
  const lastVisitedAt = selectedThread.lastVisitedAt;
  const completedAt = selectedThread.latestRun?.completedAt;
  useEffect(() => {
    if (
      !visible ||
      AppState.currentState !== "active" ||
      tabActivity?.isActive() === false ||
      lastVisitedAt === undefined
    )
      return;
    const updatedAtMs = Date.parse(updatedAt);
    if (Number.isNaN(updatedAtMs)) return;
    const lastVisitedAtMs = lastVisitedAt ? Date.parse(lastVisitedAt) : NaN;
    if (!Number.isNaN(lastVisitedAtMs) && lastVisitedAtMs >= updatedAtMs) return;
    const dispatchKey = `${threadKey}:${updatedAt}`;
    if (lastDispatched.current === dispatchKey) return;
    const dispatch = () => {
      if (!visible || AppState.currentState !== "active" || tabActivity?.isActive() === false)
        return;
      lastDispatched.current = dispatchKey;
      lastDispatch.current = { threadKey, at: Date.now() };
      void visitThread({ environmentId, input: { threadId, visitedAt: updatedAt } });
    };
    // Completion clears unread state immediately. Streaming uses the existing
    // ten-second trailing throttle, but only while this thread is visible.
    const completedAtMs = completedAt ? Date.parse(completedAt) : NaN;
    const unseenCompletion =
      !Number.isNaN(completedAtMs) &&
      (Number.isNaN(lastVisitedAtMs) || completedAtMs > lastVisitedAtMs);
    const previous = lastDispatch.current;
    const elapsed = Date.now() - previous.at;
    if (previous.threadKey !== threadKey || unseenCompletion || elapsed >= 10_000) {
      dispatch();
      return;
    }
    const timer = setTimeout(dispatch, 10_000 - elapsed);
    return () => clearTimeout(timer);
  }, [
    completedAt,
    environmentId,
    lastVisitedAt,
    tabActivity,
    threadId,
    threadKey,
    updatedAt,
    visible,
    visitThread,
  ]);
}
