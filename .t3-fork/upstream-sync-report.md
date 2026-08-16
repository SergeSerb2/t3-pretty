# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260816.1105`
- Previously integrated parent nightly: `v0.0.34-nightly.20260815.1102`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Preserved the pullRequestDiffIdentity import used by T3 Pretty's logic for keeping an open pull request current.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Preserved the T3 Pretty `pullRequestDiffIdentity` test dependency, which protects fork behavior for keeping the current pull request and its diff identity stable.

## Parent changes integrated at conflict boundaries

- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Integrated upstream's import cleanup so pullRequestActionNeedsHostRefresh is imported only once in its new shared position after pullRequestActionMenuHasGroup.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.test.ts` — Integrated upstream's `pullRequestActionMenuHasGroup` import and retained the upstream placement of `pullRequestActionNeedsHostRefresh`, avoiding a duplicate import.

## Parent changes intentionally omitted

- None. The resolver did not omit any parent change to protect T3 Pretty.
