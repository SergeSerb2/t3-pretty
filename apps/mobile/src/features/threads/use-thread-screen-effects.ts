import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { useContext, useEffect, useRef } from "react";
import { AppState } from "react-native";

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
