import type {
  PullRequestCheck,
  PullRequestCheckStatus,
  PullRequestChecksState,
  PullRequestMergeability,
  PullRequestReviewDecision,
  PullRequestState,
} from "@t3tools/contracts";

export type PullRequestStateKind = "merged" | "closed" | "draft" | "conflicting" | "open";

export interface PullRequestStatePresentation {
  readonly kind: PullRequestStateKind;
  readonly label: string;
  readonly symbol:
    | "point.topleft.down.curvedto.point.bottomright.up"
    | "xmark"
    | "doc.text"
    | "exclamationmark.triangle"
    | "arrow.triangle.pull";
  readonly textClassName: string;
  readonly badgeClassName: string;
}

/**
 * How a pull request's state reads on this surface. Open, closed and merged use the same
 * colours as the thread list PR badge; draft and conflicts are states that badge never shows.
 */
export function resolvePullRequestState(input: {
  readonly state: PullRequestState;
  readonly isDraft: boolean;
  readonly mergeability?: PullRequestMergeability;
  readonly baseBranch?: string;
}): PullRequestStatePresentation {
  if (input.state === "merged") {
    return {
      kind: "merged",
      label: "Merged",
      symbol: "point.topleft.down.curvedto.point.bottomright.up",
      textClassName: "text-violet-600 dark:text-violet-400",
      badgeClassName: "bg-violet-500/15",
    };
  }
  if (input.state === "closed") {
    return {
      kind: "closed",
      label: "Closed",
      symbol: "xmark",
      textClassName: "text-red-600 dark:text-red-400",
      badgeClassName: "bg-red-500/15",
    };
  }
  if (input.isDraft) {
    return {
      kind: "draft",
      label: "Draft",
      symbol: "doc.text",
      textClassName: "text-zinc-500 dark:text-zinc-400",
      badgeClassName: "bg-zinc-500/15",
    };
  }
  if (input.mergeability === "conflicting") {
    return {
      kind: "conflicting",
      label: input.baseBranch ? `Conflicts with ${input.baseBranch}` : "Has conflicts",
      symbol: "exclamationmark.triangle",
      textClassName: "text-danger-foreground",
      badgeClassName: "bg-danger",
    };
  }
  return {
    kind: "open",
    label: "Open",
    symbol: "arrow.triangle.pull",
    textClassName: "text-emerald-600 dark:text-emerald-400",
    badgeClassName: "bg-emerald-500/15",
  };
}

export function summarizePullRequestChecks(checks: ReadonlyArray<PullRequestCheck>): string {
  if (checks.length === 0) return "No checks reported";
  const failed = checks.filter(
    (check) => check.status === "failure" || check.status === "cancelled",
  ).length;
  const pending = checks.filter((check) => check.status === "pending").length;
  const passed = checks.filter((check) => check.status === "success").length;
  if (failed > 0) return `${failed} of ${checks.length} failing`;
  if (pending > 0) return `${pending} of ${checks.length} running`;
  return passed === checks.length ? "All checks passed" : `${passed} of ${checks.length} passing`;
}

export function pullRequestCheckStatusLabel(status: PullRequestCheckStatus): string {
  switch (status) {
    case "pending":
      return "Running";
    case "success":
      return "Passed";
    case "failure":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "neutral":
      return "Neutral";
    case "cancelled":
      return "Cancelled";
  }
}

export function pullRequestCheckSymbol(
  status: PullRequestCheckStatus,
): "clock" | "checkmark.circle" | "xmark.circle.fill" | "minus.circle" {
  switch (status) {
    case "pending":
      return "clock";
    case "success":
      return "checkmark.circle";
    case "failure":
    case "cancelled":
      return "xmark.circle.fill";
    case "skipped":
    case "neutral":
      return "minus.circle";
  }
}

const CHECK_STATUS_TINT: Record<PullRequestCheckStatus, string> = {
  pending: "#d97706",
  success: "#059669",
  failure: "#dc2626",
  cancelled: "#dc2626",
  skipped: "#71717a",
  neutral: "#71717a",
};

export function pullRequestCheckStatusTint(status: PullRequestCheckStatus): string {
  return CHECK_STATUS_TINT[status];
}

export function pullRequestCheckStatusTextClass(status: PullRequestCheckStatus): string {
  switch (status) {
    case "pending":
      return "text-amber-600 dark:text-amber-400";
    case "success":
      return "text-emerald-600 dark:text-emerald-400";
    case "failure":
    case "cancelled":
      return "text-red-600 dark:text-red-400";
    case "skipped":
    case "neutral":
      return "text-foreground-muted";
  }
}

/** "CHANGES_REQUESTED" reads as "Changes requested": one capital, the host's underscores gone. */
export function formatReviewState(state: string): string {
  const words = state.toLowerCase().replace(/[_-]+/gu, " ").trim();
  if (words.length === 0) return state;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Only a verdict somebody has actually given. "Review required" is the absence of one, and
 * saying so on every unreviewed row would say nothing.
 */
export function describeReviewDecision(
  decision: PullRequestReviewDecision | undefined,
): string | null {
  if (decision === "approved") return "Approved";
  if (decision === "changes-requested") return "Changes requested";
  return null;
}

export function describeChecksState(state: PullRequestChecksState | undefined): string | null {
  if (state === "passing") return "Checks passed";
  if (state === "failing") return "Checks failing";
  if (state === "pending") return "Checks running";
  return null;
}

export function reviewDecisionTextClass(decision: PullRequestReviewDecision): string {
  return decision === "approved"
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-amber-600 dark:text-amber-400";
}

export function checksStateTextClass(state: PullRequestChecksState): string {
  switch (state) {
    case "passing":
      return "text-emerald-600 dark:text-emerald-400";
    case "failing":
      return "text-red-600 dark:text-red-400";
    case "pending":
      return "text-amber-600 dark:text-amber-400";
  }
}

/** A host colour only when it is one, so a malformed value falls back to the neutral pill. */
export function pullRequestLabelColor(color: string | null): string | null {
  const hex = color?.trim().replace(/^#/u, "") ?? "";
  return /^[0-9a-fA-F]{6}$/u.test(hex) ? `#${hex}` : null;
}

export function formatDiffStat(additions: number, deletions: number): string | null {
  if (
    !Number.isSafeInteger(additions) ||
    additions < 0 ||
    !Number.isSafeInteger(deletions) ||
    deletions < 0
  ) {
    return null;
  }
  if (additions === 0 && deletions === 0) return null;
  return `+${additions.toLocaleString()} −${deletions.toLocaleString()}`;
}
