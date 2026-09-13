import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";

import type { DraftId } from "~/composerDraftStore";

export const PULL_REQUEST_PANEL_TABS = ["summary", "timeline", "code"] as const;
export type PullRequestPanelTab = (typeof PULL_REQUEST_PANEL_TABS)[number];

export const PULL_REQUEST_SUMMARY_SECTIONS = ["description", "checks", "comments"] as const;
export type PullRequestSummarySection = (typeof PULL_REQUEST_SUMMARY_SECTIONS)[number];

export const PULL_REQUEST_TAB_SCROLL_ATTR = "data-pull-request-tab-scroll";

/**
 * One pull-request panel's place in the session: tab, scroll, and the summary bits that
 * decide what that scroll number is pointing at. Held outside the component because the
 * thread's right panel remounts whenever the reader leaves — a new thread for a finding,
 * another thread in the sidebar — and the DOM it was scrolled in goes with it.
 */
export type PullRequestPanelViewSnapshot = {
  readonly tab?: PullRequestPanelTab;
  readonly timelineOrder?: "newest" | "oldest";
  readonly selectedCodeCommitOid?: string | null;
  readonly chromeCondensedByTab?: Partial<Record<PullRequestPanelTab, boolean>>;
  readonly scrollTopByTab?: Partial<Record<PullRequestPanelTab, number>>;
  readonly commentOrder?: "newest" | "oldest";
  readonly shownCommentCount?: number;
  /** Origin Grok auto-review write-ups stay hidden unless the reader asks for them. */
  readonly showGrokReviewSummaries?: boolean;
  readonly sectionOpen?: Partial<Record<PullRequestSummarySection, boolean>>;
};

/** The thread (or draft, or the pull-request list page) this panel is sitting beside. */
export function pullRequestPanelSessionKey(
  composerDraftTarget: ScopedThreadRef | DraftId | undefined,
  environmentId: EnvironmentId,
): string {
  if (composerDraftTarget === undefined) return `page:${environmentId}`;
  if (typeof composerDraftTarget === "string") return `draft:${composerDraftTarget}`;
  return scopedThreadKey(composerDraftTarget);
}

export function pullRequestPanelViewKey(
  sessionKey: string,
  reference: {
    readonly projectId: string;
    readonly repository: string;
    readonly number: number;
  },
): string {
  return `${sessionKey}:${reference.projectId}:${encodeURIComponent(reference.repository)}#${reference.number}`;
}

export function clampRestoredScrollTop(input: {
  readonly savedScrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}): number {
  const max = Math.max(0, input.scrollHeight - input.clientHeight);
  return Math.min(Math.max(0, input.savedScrollTop), max);
}

export function findPullRequestTabScroller(
  viewport: HTMLElement,
  tab: PullRequestPanelTab,
): HTMLElement | null {
  return viewport.querySelector(`[${PULL_REQUEST_TAB_SCROLL_ATTR}="${tab}"]`);
}

function mergePartial<T extends object>(
  previous: T | undefined,
  patch: T | undefined,
): T | undefined {
  if (previous === undefined) return patch;
  if (patch === undefined) return previous;
  return { ...previous, ...patch };
}

export function mergePullRequestPanelView(
  previous: PullRequestPanelViewSnapshot | undefined,
  patch: PullRequestPanelViewSnapshot,
): PullRequestPanelViewSnapshot {
  const {
    chromeCondensedByTab: _chrome,
    scrollTopByTab: _scroll,
    sectionOpen: _sections,
    ...flat
  } = {
    ...previous,
    ...patch,
  };
  const chromeCondensedByTab = mergePartial(
    previous?.chromeCondensedByTab,
    patch.chromeCondensedByTab,
  );
  const scrollTopByTab = mergePartial(previous?.scrollTopByTab, patch.scrollTopByTab);
  const sectionOpen = mergePartial(previous?.sectionOpen, patch.sectionOpen);
  return {
    ...flat,
    ...(chromeCondensedByTab === undefined ? {} : { chromeCondensedByTab }),
    ...(scrollTopByTab === undefined ? {} : { scrollTopByTab }),
    ...(sectionOpen === undefined ? {} : { sectionOpen }),
  };
}

/**
 * Identity of a pull request selection that came in through the URL. The page opens the linked
 * pull request in its panel once per selection, keyed by this string rather than by object
 * identity: the selection object is rebuilt whenever the project catalog re-emits, and reopening
 * on every rebuild put a closed panel straight back on screen.
 */
export function linkedPullRequestKey(
  selection: {
    readonly environmentId: string;
    readonly repository: string;
    readonly number: number;
  } | null,
): string | null {
  return selection === null
    ? null
    : `${selection.environmentId}:${selection.repository}#${selection.number}`;
}
