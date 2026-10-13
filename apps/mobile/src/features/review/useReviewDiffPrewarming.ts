import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { getCachedNativeReviewDiffData } from "./nativeReviewDiffAdapter";
import type { ReviewSectionItem } from "./reviewModel";
import {
  getCachedReviewParsedDiff,
  getReviewParsedDiffSourceCharacterCount,
  MAX_CACHED_REVIEW_DIFFS,
  MAX_CACHED_REVIEW_SOURCE_CHARACTERS,
} from "./reviewState";

interface IdleDeadlineLike {
  readonly didTimeout: boolean;
  timeRemaining(): number;
}

type IdleCallback = (deadline: IdleDeadlineLike) => void;
export const REVIEW_DIFF_PREWARM_MAX_SECTIONS = 4;
export const REVIEW_DIFF_PREWARM_MAX_CHARACTERS = 1_000_000;

function subscribeAppState(onChange: () => void) {
  const subscription = AppState.addEventListener("change", onChange);
  return () => subscription.remove();
}

const getAppIsActive = () => AppState.currentState === "active";

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
  if (section.diff === null || section.diff.length > REVIEW_DIFF_PREWARM_MAX_CHARACTERS) {
    return;
  }

  const parsedDiff = getCachedReviewParsedDiff({
    threadKey,
    sectionId: section.id,
    diff: section.diff,
  });
  getCachedNativeReviewDiffData({ parsedDiff, comments: [] });
}

/** Bounds speculative parsing, while reserving the selected section's cache budget. */
export function getReviewDiffPrewarmSections(input: {
  readonly threadKey: string;
  readonly sections: ReadonlyArray<ReviewSectionItem>;
  readonly selectedSectionId: string | null;
}): ReadonlyArray<ReviewSectionItem> {
  const { threadKey, sections, selectedSectionId } = input;
  const selectedIndex = sections.findIndex((section) => section.id === selectedSectionId);
  const selectedSection = sections[selectedIndex];
  if (!selectedSection) {
    return [];
  }

  let sourceCharacterCount = getReviewParsedDiffSourceCharacterCount({
    threadKey,
    sectionId: selectedSection.id,
    diff: selectedSection.diff,
  });
  if (sourceCharacterCount > MAX_CACHED_REVIEW_SOURCE_CHARACTERS) {
    return [];
  }

  const pendingSections: ReviewSectionItem[] = [];
  let prewarmCharacterCount = 0;
  for (let distance = 1; distance < sections.length; distance += 1) {
    for (const index of [selectedIndex - distance, selectedIndex + distance]) {
      if (
        pendingSections.length >=
        Math.min(REVIEW_DIFF_PREWARM_MAX_SECTIONS, MAX_CACHED_REVIEW_DIFFS - 1)
      ) {
        return pendingSections;
      }
      const section = sections[index];
      if (!section || section.diff === null) {
        continue;
      }
      const sectionCharacterCount = getReviewParsedDiffSourceCharacterCount({
        threadKey,
        sectionId: section.id,
        diff: section.diff,
      });
      if (
        prewarmCharacterCount + section.diff.length > REVIEW_DIFF_PREWARM_MAX_CHARACTERS ||
        sourceCharacterCount + sectionCharacterCount > MAX_CACHED_REVIEW_SOURCE_CHARACTERS
      ) {
        continue;
      }
      pendingSections.push(section);
      prewarmCharacterCount += section.diff.length;
      sourceCharacterCount += sectionCharacterCount;
    }
  }
  return pendingSections;
}

/** Warms one nearby section per idle period, after navigation animations finish. */
export function useReviewDiffPrewarming(input: {
  readonly enabled?: boolean;
  readonly threadKey: string | null;
  readonly sections: ReadonlyArray<ReviewSectionItem>;
  readonly selectedSectionId: string | null;
}): void {
  const { sections, selectedSectionId, threadKey } = input;
  const enabled = input.enabled ?? true;
  const appIsActive = useSyncExternalStore(subscribeAppState, getAppIsActive);

  useEffect(() => {
    if (!enabled || !appIsActive || !threadKey) {
      return;
    }

    const pendingSections = getReviewDiffPrewarmSections({
      threadKey,
      sections,
      selectedSectionId,
    });
    if (pendingSections.length === 0) {
      return;
    }

    let cancelled = false;
    let idleHandle: number | null = null;
    let nextSectionIndex = 0;

    const scheduleNext = () => {
      idleHandle = scheduleIdle(() => {
        if (cancelled || !getAppIsActive()) {
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
  }, [enabled, appIsActive, sections, selectedSectionId, threadKey]);
}
