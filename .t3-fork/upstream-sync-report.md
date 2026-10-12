# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261011.2994`
- Previously integrated parent nightly: `v0.0.46-nightly.20261011.2980`
- Conflict resolver: reused `automation/sync-resolution-cache` from Buildkite #3398, then hand-completed the remaining mobile navigation/typecheck work

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/src/Stack.tsx` — Pretty Home remains `HomeRouteScreen` (mint-glass chrome, Automations, Trailhead, and the existing Pretty pull-request stack).
- `apps/mobile/src/Stack.tsx` — Pretty list/detail/comment/diff routes stay registered: `PullRequests`, `PullRequestDetail`, `PullRequestComment`, `PullRequestDiff`, and the Pretty reviewers sheet as `PullRequestReviewersSheet`.
- `apps/mobile/src/features/home/HomeRouteScreen.tsx` — Pretty home header, top bar, automations, pull-request entry, `startNewTask`, and `markThreadOpenStarted` remain wired.
- `apps/mobile/src/features/pull-requests/PullRequestsScreen.tsx` — Pretty's prop-driven multi-environment list remains the `PullRequests` stack screen.
- `apps/mobile/src/features/pull-requests/usePullRequestList.ts` — Pretty's filtered list hook remains the `PullRequestsRouteScreen` data source.
- `apps/mobile/src/features/pull-requests/PullRequestMarkdown.tsx` — Pretty markdown density/styling remains the renderer used by Pretty conversation and detail screens.
- `.github/workflows` — fork-owned sync, signing, release, and security workflows stay pinned to Pretty main.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/Stack.tsx` — Parent first-party pull-request routes are registered: `PullRequest`, `PullRequestGuideStop`, `PullRequestFile`, `PullRequestFiles`, `PullRequestDiscussion`, `PullRequestInlineComment`, `PullRequestReview`, and parent `PullRequestReviewers`.
- `apps/mobile/src/features/home/HomeRouteScreen.tsx` — Optional workspace-tab search, scratch-project scope resolution, and workspace-toolbar awareness are composed onto Pretty home.
- Forty-six other conflicted files reused the exact diff3 resolutions checkpointed by scheduled sync #3398 (server HTTP/hydration, client-runtime persistence, web Sidebar/ChatView/ProviderInstanceCard, mobile chrome, and settings).
- Parent mobile pull-request screens, hooks, and guide files that were new in 2994 are kept in the tree and reachable through the new stack routes.

## Parent changes omitted to protect T3 Pretty

- `.github/workflows` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned.
- `apps/mobile/src/Stack.tsx` — Home was not replaced with `WorkspaceRootScreen`. Reason: Pretty home UI (top bar, automations, mint-glass header, thread performance marks) is the fork's primary workspace; parent tab-root remains available for later use.
- `apps/mobile/src/features/pull-requests/PullRequestsScreen.tsx` — parent no-arg list did not replace Pretty's prop-driven list. Reason: `PullRequestsRouteScreen` already owns Pretty's multi-host filters. Parent's self-contained list is kept as `WorkspacePullRequestsScreen`.
- `apps/mobile/src/features/pull-requests/PullRequestMarkdown.tsx` — parent markdown implementation was not substituted wholesale. Reason: Pretty conversation/detail styling stays; parent `PullRequestMarkdownRepository` is exported so parent screens compile.

## Hand-complete notes

- The scheduled sync merged 2994 and repaired shared/web/server typechecks on the agent, then failed mobile typecheck because parent `navigate("PullRequest", …)` had no `RootParamList` entry. That merged tree was never pushed.
- `PullRequestReviewers` is the parent reviewers sheet. Pretty's reviewers sheet is `PullRequestReviewersSheet` so both param lists typecheck.
- `use-thread-model-identity.ts` now calls `buildModelOptions` with the parent 4-argument signature.
- `WorkspaceRootScreen` (parent tab root, not mounted as Home) renders `WorkspacePullRequestsScreen` instead of Pretty's prop-driven list.
