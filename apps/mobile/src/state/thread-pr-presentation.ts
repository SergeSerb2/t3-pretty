import type { VcsStatusResult } from "@t3tools/contracts";
import {
  resolveAutomatedReviewPresentation,
  resolveChangeRequestPresentation,
  type AutomatedReviewPresentation,
} from "@t3tools/shared/sourceControl";

export type ThreadPr = NonNullable<VcsStatusResult["pr"]>;

export interface ThreadPrPresentation {
  readonly number: number;
  readonly state: ThreadPr["state"];
  readonly isDraft: boolean;
  /** Provider-side last activity, bounding when a terminal state landed. */
  readonly updatedAt: string | null;
  readonly url: string;
  /** Compact pull request number label, e.g. "3774". */
  readonly label: string;
  /** Full, provider-aware label for assistive technologies. */
  readonly accessibilityLabel: string;
  readonly textClassName: string;
  readonly automatedReview: (AutomatedReviewPresentation & { state: string }) | null;
}

const PR_STATE_TEXT_CLASS: Record<ThreadPr["state"], string> = {
  open: "text-adaptive-emerald-600-400",
  merged: "text-adaptive-violet-600-400",
  closed: "text-foreground-muted",
};

export function presentThreadPr(
  pr: ThreadPr,
  provider: VcsStatusResult["sourceControlProvider"] | null | undefined,
): ThreadPrPresentation {
  const presentation = resolveChangeRequestPresentation(provider);
  const isDraft = pr.state === "open" && pr.isDraft === true;
  const automatedReviewSignal = "automatedReview" in pr ? pr.automatedReview : undefined;
  const automatedReview = resolveAutomatedReviewPresentation(automatedReviewSignal);
  const automatedReviewWithState =
    automatedReview !== null && automatedReviewSignal !== undefined
      ? {
          ...automatedReview,
          state: automatedReviewSignal === null ? "no_signal" : automatedReviewSignal.state,
        }
      : null;
  const automatedReviewLabel =
    automatedReview !== null ? `, ${automatedReview.label}` : "";
  return {
    number: pr.number,
    state: pr.state,
    isDraft,
    updatedAt: pr.updatedAt ?? null,
    url: pr.url,
    label: String(pr.number),
    accessibilityLabel: `#${pr.number} ${presentation.longName} ${isDraft ? "draft" : pr.state}${automatedReviewLabel}`,
    textClassName: isDraft ? "text-foreground-muted" : PR_STATE_TEXT_CLASS[pr.state],
    automatedReview: automatedReviewWithState,
  };
}
