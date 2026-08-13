# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260813.1081`
- Previously integrated parent nightly: `v0.0.34-nightly.20260812.1077`
- Conflict resolver: manual composition after the scheduled sync refused 19 files (limit was 12). The file cap is now 24 with a 45-minute job timeout so a clustered pull-request nightly can finish under the same preservation contract.

## T3 Pretty changes preserved at conflict boundaries

- `apps/server/src/git/GitManager.ts` — Pull-request lookup still supports prefer-open versus latest so a turn-end detection can choose the newest request rather than only an open one.
- `apps/web/src/components/ChatView.tsx` — Right-panel pull-request identity still uses the fork's selected surface, including canvas, while adopting the parent's project-aware ownership helper.
- `apps/web/src/components/clerk/MobileClientsUserProfilePage.tsx` — Empty-state and page copy still use Surge Code / Surge Connect names on the parent's shared Clerk profile layout.
- `apps/web/src/components/clerk/T3ConnectSidebarSignIn.tsx` — Sign-in and profile-page labels still use Surge Code / Surge Connect rather than parent branding.
- `apps/web/src/components/clerk/T3ConnectUserProfilePage.tsx` — Environment management copy still uses Surge Connect on the parent's shared Clerk profile layout.
- `apps/web/src/components/pullRequest/PullRequestCodeTab.tsx` — A thread card still disables every Fix control while any finding hand-off is preparing, and still uses the parent's per-finding label.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — Host-specific resolve-handoff guidance still reads the pull request URL host, and the parent's in-thread versus page handoff labels remain.
- `apps/web/src/components/pullRequest/PullRequestReviewAnnotation.tsx` — Resolved threads still collapse when the host marks them resolved after mount, Fix stays disabled during any in-flight hand-off, and comment editing / reacting from the parent remain.
- `apps/web/src/components/pullRequest/PullRequestTimelineTab.tsx` — Resolved timeline remarks still dim, on top of the parent's group hover treatment.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Timeline events still carry isResolved, and host-specific resolve guidance remains available to handoffs.
- `docs/user/source-control.md` — Automatic thread settlement, Codex Auto Review public-signal wording, and the iPhone native pull-request manager remain documented.
- `packages/contracts/src/pullRequest.ts` — Unknown GitHub reaction types are still dropped instead of failing comment decode, on top of the parent's actor-aware reaction struct.
- `packages/contracts/src/pullRequest.test.ts` — Forward-compatible reaction coverage remains next to the parent's update-branch and auto-merge tests.
- `apps/server/src/pullRequest/gitHubPullRequestJson.ts` — Activity comments and reviews still decode `reactionGroups` when a payload carries them, then GraphQL overlay replaces those counts.

## Parent changes integrated at conflict boundaries

- `apps/server/src/git/GitManager.ts` — Source-control provider errors are identified with the parent's schema guard.
- `apps/server/src/pullRequest/GitHubPullRequestCli.ts` — Dismissal reasons are paged from GraphQL alongside reaction maps.
- `apps/server/src/pullRequest/GitHubPullRequestProvider.ts` — First-party reactions, dismissed-review body fallback, base comparison, behind-by, and update-branch viewer standing.
- `apps/server/src/pullRequest/gitHubPullRequestJson.ts` — First-party reaction groups with reactor counts (including GitHub Apps), auto-merge, and dismissal decoding.
- `apps/server/src/pullRequest/PullRequestProvider.ts` — Base comparison, behind-by, auto-merge, omitted file stats, and reaction-content types.
- `apps/server/src/pullRequest/PullRequestService.ts` — Detail reads the viewer concurrently and forwards base comparison, behind-by, and auto-merge.
- `apps/web/src/components/ChatView.tsx` — `isThreadOwnPullRequest` so two checkouts of the same repository do not share ownership.
- `apps/web/src/components/Sidebar.tsx` — Pull-request numbers are real links so modifier-click opens the host.
- `apps/web/src/components/clerk/MobileClientsUserProfilePage.tsx` — Shared Clerk profile page, refresh button, and type scale.
- `apps/web/src/components/pullRequest/PullRequestCodeTab.tsx` — Per-finding Fix label and comment editing / reacting.
- `apps/web/src/components/pullRequest/PullRequestDetailPanel.tsx` — In-thread versus page handoff labels.
- `apps/web/src/components/pullRequest/PullRequestReviewAnnotation.tsx` — In-place comment editing, reaction bar refresh, and configurable Fix label.
- `apps/web/src/components/pullRequest/pullRequestPresentation.tsx` — Display-only reaction pills were removed; the first-party reaction bar is the conversation UI.
- `apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx` — First-party description editing, collapsed resolved/dismissed remarks, and reaction bars.
- `apps/web/src/components/pullRequest/PullRequestTimelineTab.tsx` — Group hover treatment for editable timeline remarks.
- `apps/web/src/components/pullRequest/pullRequestDetail.logic.ts` — Required reaction arrays, update-branch helpers, and ownership / handoff-label helpers.
- `docs/user/source-control.md` — In-place title, description, and comment editing.
- `packages/contracts/src/pullRequest.ts` — Viewer identity, base comparison, behind-by, and auto-merge on detail.

## Parent changes intentionally omitted

- `apps/web/src/components/clerk/MobileClientsUserProfilePage.tsx` — Parent “T3 Code” / “T3 Connect” profile copy. Reason: T3 Pretty user-facing connect branding is Surge Code / Surge Connect; the parent's Clerk layout and type scale were kept.
- `apps/web/src/components/clerk/T3ConnectSidebarSignIn.tsx` — Parent “T3 Connect” profile-page label. Reason: the page is the fork's Surge Connect account surface.
- `apps/web/src/components/clerk/T3ConnectUserProfilePage.tsx` — Parent “T3 Connect” environment-management copy. Reason: same Surge Connect identity; protocol names and the t3-connect URL were left unchanged.
- `apps/web/src/components/ChatView.tsx` — Using `activeRightPanelSurface` for pull-request ownership. Reason: the fork's selected surface is what the panel actually renders, including canvas, so ownership has to follow that selection.
- `.github/workflows` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
