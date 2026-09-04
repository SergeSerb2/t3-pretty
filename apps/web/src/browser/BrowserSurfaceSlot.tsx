"use client";

import { useLayoutEffect, useRef } from "react";

import { acquireBrowserSurface } from "./browserSurfaceStore";

const windowGeometryListeners = new Set<() => void>();
let windowGeometryFrameId = 0;

const scheduleWindowGeometryUpdate = () => {
  if (windowGeometryFrameId !== 0) return;
  windowGeometryFrameId = window.requestAnimationFrame(() => {
    windowGeometryFrameId = 0;
    for (const listener of windowGeometryListeners) listener();
  });
};

function subscribeWindowGeometry(listener: () => void): () => void {
  windowGeometryListeners.add(listener);
  if (windowGeometryListeners.size === 1) {
    window.addEventListener("resize", scheduleWindowGeometryUpdate);
    window.addEventListener("scroll", scheduleWindowGeometryUpdate, {
      capture: true,
      passive: true,
    });
  }
  return () => {
    windowGeometryListeners.delete(listener);
    if (windowGeometryListeners.size > 0) return;
    window.removeEventListener("resize", scheduleWindowGeometryUpdate);
    window.removeEventListener("scroll", scheduleWindowGeometryUpdate, true);
    if (windowGeometryFrameId !== 0) {
      window.cancelAnimationFrame(windowGeometryFrameId);
      windowGeometryFrameId = 0;
    }
  };
}

export function BrowserSurfaceSlot(props: {
  readonly tabId: string;
  readonly visible: boolean;
  readonly cornerRadius?: number;
  readonly layoutVersion?: string | number;
  readonly className?: string;
  readonly fitSourceContent?: boolean;
}) {
  const {
    tabId,
    visible,
    cornerRadius = 0,
    layoutVersion,
    className,
    fitSourceContent = false,
  } = props;
  const elementRef = useRef<HTMLDivElement | null>(null);
  const presentationRef = useRef({ visible, cornerRadius });
  const updateRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let lease = acquireBrowserSurface(tabId, fitSourceContent);
    const update = () => {
      const rect = element.getBoundingClientRect();
      const presentation = presentationRef.current;
      const presented = lease.present(
        {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        },
        presentation.visible && rect.width > 0 && rect.height > 0,
        presentation.cornerRadius,
      );
      if (presentation.visible && !presented) {
        lease.release();
        lease = acquireBrowserSurface(tabId, fitSourceContent);
        lease.present(
          {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.max(1, Math.round(rect.width)),
            height: Math.max(1, Math.round(rect.height)),
          },
          rect.width > 0 && rect.height > 0,
          presentation.cornerRadius,
        );
      }
    };
    updateRef.current = update;
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const unsubscribeWindowGeometry = subscribeWindowGeometry(update);
    return () => {
      observer.disconnect();
      unsubscribeWindowGeometry();
      if (updateRef.current === update) updateRef.current = null;
      lease.release();
    };
  }, [fitSourceContent, tabId]);

  useLayoutEffect(() => {
    presentationRef.current = { visible, cornerRadius };
    updateRef.current?.();
  }, [cornerRadius, layoutVersion, visible]);

  return <div ref={elementRef} className={className} data-browser-surface-slot={tabId} />;
}
