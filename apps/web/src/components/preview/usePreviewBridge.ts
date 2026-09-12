"use client";

import type {
  DesktopPreviewTabState,
  PreviewReportStatusInput,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import * as Option from "effect/Option";
import { useEffect, useEffectEvent, useMemo, useRef } from "react";

import {
  flushPendingFaviconsForThread,
  recordFaviconForThread,
  useFaviconProjectRefForThread,
} from "~/browserFaviconStore";
import { useBrowserPointerStore } from "~/browser/browserPointerStore";
import { applyPreviewDesktopState, type DesktopPreviewOverlay } from "~/previewStateStore";
import { previewEnvironment } from "~/state/preview";
import { usePreparedConnection } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";

import { previewBridge } from "./previewBridge";

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Mirrors low-latency desktop state into the store and reflects navigation
 * events back to the server. Webview lifetime is owned by ElectronBrowserHost.
 */
export function usePreviewBridge(input: {
  threadRef: ScopedThreadRef;
  tabId: string;
  runtimeTabId: string;
}): void {
  const { threadRef, tabId, runtimeTabId } = input;
  const clearBrowserPointer = useBrowserPointerStore((state) => state.clear);
  const reportStatus = useAtomCommand(previewEnvironment.reportStatus, "preview status report");
  const bridge = previewBridge;
  const threadKey = scopedThreadKey(threadRef);
  const stableThreadRef = useMemo(() => {
    const parsed = parseScopedThreadKey(threadKey);
    if (!parsed) throw new Error(`Invalid scoped thread key: ${threadKey}`);
    return parsed;
  }, [threadKey]);
  const projectRef = useFaviconProjectRefForThread(stableThreadRef);
  const preparedConnection = usePreparedConnection(stableThreadRef.environmentId);
  const environmentHostname = Option.isSome(preparedConnection)
    ? new URL(preparedConnection.value.httpBaseUrl).hostname
    : undefined;

  // One bridge subscription does both jobs (mirror state + forward to
  // server) so the desktop bridge keeps a single listener entry per tab.
  const reportTracker = useRef(createPreviewReportTracker());
  const reportGeneration = useRef(0);
  const latestReportInput = useRef<PreviewReportStatusInput | null>(null);
  const lastDesktopNavStatus = useRef<DesktopPreviewTabState["navStatus"] | null>(null);
  const handleStateChange = useEffectEvent(
    (changedTabId: string, state: DesktopPreviewTabState): void => {
      if (changedTabId !== runtimeTabId) return;
      if (shouldClearBrowserPointer(lastDesktopNavStatus.current, state.navStatus)) {
        clearBrowserPointer(runtimeTabId);
      }
      lastDesktopNavStatus.current = state.navStatus;
      applyPreviewDesktopState(stableThreadRef, tabId, projectDesktopState(state));
      if (state.favicon) {
        recordFaviconForThread(stableThreadRef, state.favicon, projectRef, environmentHostname);
      }
      const reportInput = buildPreviewReportInput({
        threadId: stableThreadRef.threadId,
        tabId,
        state,
      });
      latestReportInput.current = reportInput;
      if (!reportInput) return;
      const generation = reportGeneration.current;
      void reportPreviewStatusWithRetry({
        tracker: reportTracker.current,
        input: reportInput,
        isCurrent: () =>
          generation === reportGeneration.current &&
          previewReportStatusInputsEqual(latestReportInput.current, reportInput),
        send: () =>
          reportStatus({
            environmentId: stableThreadRef.environmentId,
            input: reportInput,
          }).then(
            (result) => result._tag === "Success",
            () => false,
          ),
      });
    },
  );
  useEffect(() => {
    if (!bridge || typeof window === "undefined") return;
    reportGeneration.current += 1;
    latestReportInput.current = null;
    reportTracker.current.reset();
    lastDesktopNavStatus.current = null;
    const unsubscribe = bridge.onStateChange(handleStateChange);
    return () => {
      reportGeneration.current += 1;
      latestReportInput.current = null;
      reportTracker.current.reset();
      unsubscribe();
    };
  }, [bridge, runtimeTabId, stableThreadRef, tabId]);
  useEffect(() => {
    if (!projectRef) return;
    flushPendingFaviconsForThread(stableThreadRef, projectRef, environmentHostname);
  }, [environmentHostname, projectRef, stableThreadRef]);
}

function shouldClearBrowserPointer(
  previous: DesktopPreviewTabState["navStatus"] | null,
  current: DesktopPreviewTabState["navStatus"],
): boolean {
  if (!previous) return false;
  if (current.kind === "Loading" && previous.kind !== "Loading") return true;
  if (current.kind === "Idle" || previous.kind === "Idle") return false;
  return current.url !== previous.url;
}

export function projectDesktopState(state: DesktopPreviewTabState): DesktopPreviewOverlay {
  const navOrigin = state.navStatus.kind === "Idle" ? null : originOf(state.navStatus.url);
  return {
    hasWebContents: state.webContentsId !== null,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    loading: state.navStatus.kind === "Loading",
    zoomFactor: state.zoomFactor,
    pictureInPicture: state.pictureInPicture,
    colorScheme: state.colorScheme,
    audioMuted: state.audioMuted,
    audible: state.audible,
    controller: state.controller,
    favicon: state.favicon && originOf(state.favicon.pageUrl) === navOrigin ? state.favicon : null,
  };
}

/**
 * Decide whether a state change warrants an RPC to the server, and shape
 * the report payload.
 *
 * - Idle never reports — the tab is post-close or pre-load and the server
 *   already knows the canonical state from `open` / `closed`.
 * - Consecutive identical reports collapse to a single RPC.
 * - LoadFailed always reports (the server uses it to emit `failed`).
 */
export function buildPreviewReportInput(args: {
  readonly threadId: ThreadId;
  readonly tabId: string;
  readonly state: DesktopPreviewTabState;
}): PreviewReportStatusInput | null {
  const { threadId, tabId, state } = args;
  const status = state.navStatus;
  if (status.kind === "Idle") return null;

  const base = {
    threadId,
    tabId,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
  };
  if (status.kind === "LoadFailed") {
    return {
      ...base,
      navStatus: {
        _tag: "LoadFailed",
        url: status.url,
        title: status.title,
        code: status.code,
        description: status.description,
      },
    };
  }
  return {
    ...base,
    navStatus: { _tag: status.kind, url: status.url, title: status.title },
  };
}

export function previewReportStatusInputsEqual(
  left: PreviewReportStatusInput | null,
  right: PreviewReportStatusInput | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (
    left.threadId !== right.threadId ||
    left.tabId !== right.tabId ||
    left.canGoBack !== right.canGoBack ||
    left.canGoForward !== right.canGoForward ||
    left.navStatus._tag !== right.navStatus._tag
  ) {
    return false;
  }
  if (left.navStatus._tag === "Idle" || right.navStatus._tag === "Idle") return true;
  if (
    left.navStatus.url !== right.navStatus.url ||
    left.navStatus.title !== right.navStatus.title
  ) {
    return false;
  }
  return left.navStatus._tag !== "LoadFailed" || right.navStatus._tag !== "LoadFailed"
    ? true
    : left.navStatus.code === right.navStatus.code &&
        left.navStatus.description === right.navStatus.description;
}

interface PreviewReportAttempt {
  readonly input: PreviewReportStatusInput;
  readonly sequence: number;
}

export async function reportPreviewStatusWithRetry(input: {
  readonly tracker: PreviewReportTracker;
  readonly input: PreviewReportStatusInput;
  readonly send: () => Promise<boolean>;
  readonly isCurrent: () => boolean;
  readonly maxAttempts?: number;
}): Promise<void> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? 2);
  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    if (!input.isCurrent()) return;
    const attempt = input.tracker.request(input.input);
    if (!attempt) return;
    const succeeded = await input.send();
    input.tracker.settle(attempt, succeeded);
    if (succeeded || !input.isCurrent()) return;
  }
}

export interface PreviewReportTracker {
  readonly request: (input: PreviewReportStatusInput) => PreviewReportAttempt | null;
  readonly settle: (attempt: PreviewReportAttempt, succeeded: boolean) => void;
  readonly reset: () => void;
}

export function createPreviewReportTracker(): PreviewReportTracker {
  let requested: PreviewReportStatusInput | null = null;
  let acknowledged: PreviewReportStatusInput | null = null;
  let sequence = 0;

  return {
    request: (input) => {
      if (
        input.navStatus._tag !== "LoadFailed" &&
        previewReportStatusInputsEqual(requested, input)
      ) {
        return null;
      }
      requested = input;
      return { input, sequence: ++sequence };
    },
    settle: (attempt, succeeded) => {
      if (
        attempt.sequence !== sequence ||
        !previewReportStatusInputsEqual(requested, attempt.input)
      ) {
        return;
      }
      if (succeeded) acknowledged = attempt.input;
      else requested = acknowledged;
    },
    reset: () => {
      requested = null;
      acknowledged = null;
      sequence += 1;
    },
  };
}
