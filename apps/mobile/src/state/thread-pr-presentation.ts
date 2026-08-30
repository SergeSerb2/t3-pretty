import type { VcsStatusResult } from "@t3tools/contracts";
import {
  resolveAutomatedReviewPresentation,
  resolveChangeRequestPresentation,
} from "@t3tools/shared/sourceControl";

export type ThreadPr = NonNullable<VcsStatusResult["pr"]>;

export interface ThreadPrPresentation {
  readonly number: number;
  readonly state: ThreadPr["state"];
  /** Provider-side last activity, bounding when a terminal state landed. */
  readonly updatedAt: string | null;
  readonly url: string;
  /** Compact pull request number label, e.g. "3774". */
  readonly label: string;
  /** Full, provider-aware label for assistive technologies. */
  readonly accessibilityLabel: string;
  readonly textClassName: string;
  readonly automatedReview: ThreadAutomatedReviewPresentation | null;
}

export interface ThreadAutomatedReviewPresentation {
  readonly state: NonNullable<NonNullable<ThreadPr["automatedReview"]>>["state"] | "no_signal";
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly textClassName: string;
}

const PR_STATE_TEXT_CLASS: Record<ThreadPr["state"], string> = {
  open: "text-adaptive-emerald-600-400",
  merged: "text-adaptive-violet-600-400",
  closed: "text-adaptive-zinc-500-400",
};

export function presentThreadPr(
  pr: ThreadPr,
  provider: VcsStatusResult["sourceControlProvider"] | null | undefined,
): ThreadPrPresentation {
  const presentation = resolveChangeRequestPresentation(provider);
  const automatedReviewPresentation = resolveAutomatedReviewPresentation(pr.automatedReview);
  const automatedReview = automatedReviewPresentation
    ? {
        state: pr.automatedReview?.state ?? ("no_signal" as const),
        ...automatedReviewPresentation,
        textClassName:
          pr.automatedReview?.state === "reviewing"
            ? "text-blue-600 dark:text-blue-300"
            : pr.automatedReview?.state === "passed"
              ? "text-emerald-600 dark:text-emerald-300"
              : pr.automatedReview?.state === "feedback"
                ? "text-amber-700 dark:text-amber-300"
                : "text-foreground-muted",
      }
    : null;
  return {
    number: pr.number,
    state: pr.state,
    updatedAt: pr.updatedAt ?? null,
    url: pr.url,
    label: String(pr.number),
    accessibilityLabel: `#${pr.number} ${presentation.longName} ${pr.state}${automatedReview ? `, ${automatedReview.label}` : ""}`,
    textClassName: PR_STATE_TEXT_CLASS[pr.state],
    automatedReview,
  };
}
