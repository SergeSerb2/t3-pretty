"use client";

import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { FILL_PREVIEW_VIEWPORT } from "@t3tools/contracts";
import { useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import { isElectron } from "~/env";
import { useTheme } from "~/hooks/useTheme";
import { useActivePreviewSessions } from "~/previewStateStore";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";

import { readPreviewAnnotationTheme } from "./annotationTheme";
import { useBrowserPointerStore } from "./browserPointerStore";
import { readActiveBrowserRecordingTargets } from "./browserRecording";
import { useBrowserSurfaceStore } from "./browserSurfaceStore";
import { HostedBrowserWebview } from "./HostedBrowserWebview";
import {
  MAX_RESIDENT_PREVIEW_THREADS,
  resolveResidentPreviewThreads,
  useAutomatingPreviewThreads,
} from "./previewGuestResidency";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

export function ElectronBrowserHost() {
  const { resolvedTheme } = useTheme();
  const previewByThreadKey = useActivePreviewSessions();
  const sessions = useMemo(
    () =>
      Object.entries(previewByThreadKey).flatMap(([threadKey, previewState]) => {
        const threadRef = parseScopedThreadKey(threadKey);
        return threadRef
          ? Object.values(previewState.sessions).map((snapshot) => ({
              threadKey,
              threadRef,
              snapshot,
              runtimeTabId: previewRuntimeTabId(
                threadRef,
                previewState.serverEpoch,
                snapshot.tabId,
              ),
              pictureInPicture:
                previewState.desktopByTabId[snapshot.tabId]?.pictureInPicture ?? false,
              zoomFactor: previewState.desktopByTabId[snapshot.tabId]?.zoomFactor ?? 1,
            }))
          : [];
      }),
    [previewByThreadKey],
  );

  const visibleRuntimeTabIds = useBrowserSurfaceStore(
    useShallow((state) =>
      Object.entries(state.byTabId)
        .filter(([, surface]) => surface.visible)
        .map(([runtimeTabId]) => runtimeTabId),
    ),
  );
  const miniPlayerThreadKeys = usePreviewMiniPlayerStore(
    useShallow((state) => Object.keys(state.byThreadKey)),
  );
  const automatingThreadKeys = useAutomatingPreviewThreads();
  const lastPinnedAt = useRef(new Map<string, number>()).current;

  const { resident, pinnedKeys } = useMemo(() => {
    const visible = new Set(visibleRuntimeTabIds);
    const miniPlayers = new Set(miniPlayerThreadKeys);
    const threadKeys: string[] = [];
    const pinned = new Set<string>();
    for (const session of sessions) {
      if (!threadKeys.includes(session.threadKey)) threadKeys.push(session.threadKey);
      if (
        visible.has(session.runtimeTabId) ||
        session.pictureInPicture ||
        miniPlayers.has(session.threadKey) ||
        automatingThreadKeys.has(session.threadKey) ||
        readActiveBrowserRecordingTargets(session.threadRef).length > 0
      ) {
        pinned.add(session.threadKey);
      }
    }
    return {
      pinnedKeys: pinned,
      resident: resolveResidentPreviewThreads({
        threadKeys,
        pinnedKeys: pinned,
        lastPinnedAt,
        limit: MAX_RESIDENT_PREVIEW_THREADS,
      }),
    };
  }, [automatingThreadKeys, lastPinnedAt, miniPlayerThreadKeys, sessions, visibleRuntimeTabIds]);

  useEffect(() => {
    const now = Date.now();
    for (const threadKey of pinnedKeys) lastPinnedAt.set(threadKey, now);
  }, [lastPinnedAt, pinnedKeys]);

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;

    let lastSerializedTheme = "";
    const syncTheme = () => {
      const theme = readPreviewAnnotationTheme();
      const serializedTheme = JSON.stringify(theme);
      if (serializedTheme === lastSerializedTheme) return;
      lastSerializedTheme = serializedTheme;
      void preview.setAnnotationTheme(theme).catch(() => {
        lastSerializedTheme = "";
      });
    };
    const frameId = window.requestAnimationFrame(syncTheme);
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    const headObserver = new MutationObserver(syncTheme);
    headObserver.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      headObserver.disconnect();
    };
  }, [resolvedTheme]);

  useEffect(() => {
    const preview = window.desktopBridge?.preview;
    if (!preview) return;
    return preview.onPointerEvent((event) => {
      useBrowserPointerStore.getState().apply(event);
    });
  }, []);

  if (!isElectron) return null;
  return (
    <div className="contents" data-electron-browser-host>
      {sessions.map(({ threadKey, threadRef, snapshot, runtimeTabId, zoomFactor }) => {
        // Dormant threads keep their server-side session; the guest is rebuilt
        // from the tab's last URL when the thread is used again.
        if (!resident.has(threadKey)) return null;
        const url = snapshot.navStatus._tag === "Idle" ? null : snapshot.navStatus.url;
        return (
          <HostedBrowserWebview
            key={runtimeTabId}
            threadRef={threadRef}
            tabId={snapshot.tabId}
            runtimeTabId={runtimeTabId}
            initialUrl={url}
            viewport={snapshot.viewport ?? FILL_PREVIEW_VIEWPORT}
            zoomFactor={zoomFactor}
          />
        );
      })}
    </div>
  );
}
