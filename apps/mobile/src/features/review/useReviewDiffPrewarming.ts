import { useEffect } from "react";

import { getCachedNativeReviewDiffData } from "./nativeReviewDiffAdapter";
import type { ReviewSectionItem } from "./reviewModel";
import { getCachedReviewParsedDiff } from "./reviewState";

interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

type IdleCallback = (deadline: IdleDeadlineLike) => void;

export const REVIEW_DIFF_PREWARM_MAX_SECTIONS = 4;
export const REVIEW_DIFF_PREWARM_MAX_CHARACTERS = 1_000_000;

/** Keep idle prewarming bounded so large reviews cannot become a background parse job. */
export function selectReviewDiffPrewarmSections(
  sections: ReadonlyArray<ReviewSectionItem>,
  selectedSectionId: string | null,
): ReadonlyArray<ReviewSectionItem> {
  const selected: ReviewSectionItem[] = [];
  let characters = 0;
  for (const section of sections) {
    if (selected.length >= REVIEW_DIFF_PREWARM_MAX_SECTIONS) break;
    if (section.id === selectedSectionId || section.diff === null) continue;
    const size = section.diff.length;
    if (
      size > REVIEW_DIFF_PREWARM_MAX_CHARACTERS ||
      characters + size > REVIEW_DIFF_PREWARM_MAX_CHARACTERS
    ) {
      continue;
    }
    selected.push(section);
    characters += size;
  }
  return selected;
}

function scheduleIdle(callback: IdleCallback): number {
  if (typeof globalThis.requestIdleCallback === "function") {
    return globalThis.requestIdleCallback(callback, { timeout: 2_000 });
  }

  return setTimeout(
    () => callback({ didTimeout: true, timeRemaining: () => 0 }),
    100,
  ) as unknown as number;
}

function cancelIdle(handle: number): void {
  if (typeof globalThis.cancelIdleCallback === "function") {
    globalThis.cancelIdleCallback(handle);
    return;
  }
  clearTimeout(handle);
}

export function prewarmReviewDiffSection(input: {
  readonly threadKey: string;
  readonly section: ReviewSectionItem;
}): void {
  const { section, threadKey } = input;
  if (section.diff === null) {
    return;
  }

  const parsedDiff = getCachedReviewParsedDiff({
    threadKey,
    sectionId: section.id,
    diff: section.diff,
  });
  getCachedNativeReviewDiffData({ parsedDiff, comments: [] });
}

/** Warms one cached section per idle period, after navigation animations finish. */
export function useReviewDiffPrewarming(input: {
  readonly enabled?: boolean;
  readonly threadKey: string | null;
  readonly sections: ReadonlyArray<ReviewSectionItem>;
  readonly selectedSectionId: string | null;
}): void {
  const { sections, selectedSectionId, threadKey } = input;
  const enabled = input.enabled ?? true;

  useEffect(() => {
    if (!enabled || !threadKey) {
      return;
    }

    const pendingSections = selectReviewDiffPrewarmSections(sections, selectedSectionId);
    if (pendingSections.length === 0) {
      return;
    }

    let cancelled = false;
    let idleHandle: number | null = null;
    let nextSectionIndex = 0;

    const scheduleNext = () => {
      idleHandle = scheduleIdle(() => {
        if (cancelled) {
          return;
        }

        const section = pendingSections[nextSectionIndex];
        if (!section) {
          return;
        }
        nextSectionIndex += 1;
        prewarmReviewDiffSection({ threadKey, section });

        if (nextSectionIndex < pendingSections.length) {
          scheduleNext();
        }
      });
    };

    scheduleNext();
    return () => {
      cancelled = true;
      if (idleHandle !== null) {
        cancelIdle(idleHandle);
      }
    };
  }, [enabled, sections, selectedSectionId, threadKey]);
}
