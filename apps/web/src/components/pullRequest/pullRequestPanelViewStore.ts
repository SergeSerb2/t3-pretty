import type { RefObject } from "react";
import { useLayoutEffect } from "react";

import {
  clampRestoredScrollTop,
  findPullRequestTabScroller,
  mergePullRequestPanelView,
  type PullRequestPanelTab,
  type PullRequestPanelViewSnapshot,
} from "./pullRequestPanelView.logic";

const views = new Map<string, PullRequestPanelViewSnapshot>();

export function readPullRequestPanelView(key: string): PullRequestPanelViewSnapshot | undefined {
  return views.get(key);
}

export function writePullRequestPanelView(
  key: string,
  patch: PullRequestPanelViewSnapshot,
): PullRequestPanelViewSnapshot {
  const next = mergePullRequestPanelView(views.get(key), patch);
  views.set(key, next);
  return next;
}

export function writePullRequestPanelScroll(
  key: string,
  tab: PullRequestPanelTab,
  scrollTop: number,
): void {
  const current = views.get(key)?.scrollTopByTab?.[tab];
  if (current === scrollTop) return;
  writePullRequestPanelView(key, { scrollTopByTab: { [tab]: scrollTop } });
}

/** Test helper: the map lives for the session, so each case starts empty. */
export function resetPullRequestPanelViews(): void {
  views.clear();
}

/**
 * Puts a remounted panel back where the reader left it. The saved offset is applied again
 * as the tab's content grows (cached detail arriving, markdown laying out) and stops once
 * they move the scrollbar themselves.
 */
export function usePullRequestPanelScrollRestore(input: {
  readonly viewKey: string;
  readonly tab: PullRequestPanelTab;
  readonly canRestore: boolean;
  readonly viewportRef: RefObject<HTMLElement | null>;
}): void {
  useLayoutEffect(() => {
    if (!input.canRestore) return;
    const viewport = input.viewportRef.current;
    if (viewport === null) return;
    const saved = readPullRequestPanelView(input.viewKey)?.scrollTopByTab?.[input.tab];
    if (saved === undefined) return;

    let cancelled = false;
    let restoring = false;
    let userMoved = false;

    const apply = () => {
      if (cancelled || userMoved) return;
      const scroller = findPullRequestTabScroller(viewport, input.tab);
      if (scroller === null) return;
      const next = clampRestoredScrollTop({
        savedScrollTop: saved,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      });
      if (Math.abs(scroller.scrollTop - next) <= 1) return;
      restoring = true;
      scroller.scrollTop = next;
      restoring = false;
    };

    const onScroll = (event: Event) => {
      if (restoring || userMoved) return;
      const scroller = findPullRequestTabScroller(viewport, input.tab);
      if (scroller === null || event.target !== scroller) return;
      userMoved = true;
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(viewport);
    const scroller = findPullRequestTabScroller(viewport, input.tab);
    if (scroller !== null) observer.observe(scroller);
    viewport.addEventListener("scroll", onScroll, true);
    return () => {
      cancelled = true;
      observer.disconnect();
      viewport.removeEventListener("scroll", onScroll, true);
    };
  }, [input.canRestore, input.tab, input.viewKey, input.viewportRef]);
}
