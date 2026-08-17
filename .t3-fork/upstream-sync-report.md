# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260817.1119`
- Previously integrated parent nightly: `v0.0.34-nightly.20260817.1116`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Preserved T3 Pretty's pullRequestDiffIdentity import and the existing diff-identity behavior that depends on it.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — Resolved review conversations remain visible as collapsed comments with an Unresolve action when thread resolution is supported.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — The Unresolve action continues to respect the shared resolution-pending state and uses the existing thread-resolution toggle.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Preserved tests that collapse flat review comments into one conversation thread in both oldest-first and newest-first reading order.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Preserved fork protection for orphaned review threads when a host's flat notes/comments feed omits them, including the GitLab discussions fallback case.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Preserved separate resolved and unresolved review-thread counts.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Preserved conversation summary wording for unresolved, fully resolved, and comment-only states.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Preserved collapsing all comments from a review thread into a single conversation item so resolved discussions do not appear as unfinished duplicate remarks.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Preserved visibility of orphaned review threads when the flat comment feed does not contain their comments, including independently failing host reads.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Preserved newest/oldest conversation ordering and thread activity ordering.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Preserved unresolved and resolved review-thread counters and the conversation summary text, including the “all resolved” state.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Integrated the parent latestPullRequestReviewOutcomes helper import for the newest review-outcome behavior.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — CollapsedComment now receives the already-derived visible comment body through its body prop.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Integrated review-verdict normalization tests for approved, changes-requested, and dismissed states across host-specific casing and spelling.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Integrated handling that excludes commented, pending, and null review states from verdicts.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Integrated latest-verdict-per-reviewer behavior independent of host return order, while ensuring non-verdict remarks do not overwrite a verdict.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Integrated distinct handling and stable unique keys for reviews from deleted accounts.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Integrated stale-verdict detection against commits newer than a review.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Integrated selection of the chronologically newest valid commit rather than relying on list order or lexical timestamp comparison.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Integrated timestamp-offset and invalid-date safeguards for verdict staleness calculations.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Integrated dismissal behavior that removes a reviewer's prior visible verdict.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Added normalized cross-host review verdict recognition for approved, changes-requested, and dismissed states.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Added timestamp parsing and newest-commit detection that correctly compares ISO-8601 instants with differing offsets and ignores unparseable commit dates.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Added stale-verdict detection against the newest parseable pull-request commit.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Added per-reviewer latest outcome aggregation, including distinct identities for authorless reviews, out-of-order review handling, dismissal removal, and stale status.

## Parent changes intentionally omitted

- None. The resolver did not omit any parent change to protect T3 Pretty.
