import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { AutomatedReviewSignal } from "@t3tools/contracts";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";

import type * as GitHubApi from "./GitHubApi.ts";

const CODEX_REVIEW_LOGINS = new Set(["chatgpt-codex-connector", "chatgpt-codex-connector[bot]"]);
const REVIEWED_COMMIT_PATTERN = /Reviewed commit:\*\*\s*`([0-9a-f]{7,40})`/iu;

const GitHubPageInfoSchema = Schema.Struct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
});

const GitHubCodexReactionSchema = Schema.Struct({
  content: Schema.String,
  createdAt: Schema.String,
  user: Schema.NullOr(
    Schema.Struct({
      login: Schema.String,
    }),
  ),
});

const GitHubCodexReviewSchema = Schema.Struct({
  author: Schema.NullOr(
    Schema.Struct({
      login: Schema.String,
    }),
  ),
  body: Schema.String,
  submittedAt: Schema.NullOr(Schema.String),
});

const GitHubCodexReviewPageResponseSchema = Schema.Struct({
  data: Schema.Struct({
    repository: Schema.NullOr(
      Schema.Struct({
        pullRequest: Schema.NullOr(
          Schema.Struct({
            headRefOid: Schema.String,
            headUpdates: Schema.Struct({
              updatedAt: Schema.String,
            }),
            reactions: Schema.optional(
              Schema.Struct({
                pageInfo: GitHubPageInfoSchema,
                nodes: Schema.Array(GitHubCodexReactionSchema),
              }),
            ),
            reviews: Schema.optional(
              Schema.Struct({
                pageInfo: GitHubPageInfoSchema,
                nodes: Schema.Array(GitHubCodexReviewSchema),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
});

const decodeGitHubCodexReviewPageResponse = decodeJsonResult(GitHubCodexReviewPageResponseSchema);

export interface GitHubCodexReviewPage {
  readonly headRefOid: string;
  readonly headUpdatedAt: string;
  readonly reactions: ReadonlyArray<Schema.Schema.Type<typeof GitHubCodexReactionSchema>>;
  readonly reviews: ReadonlyArray<Schema.Schema.Type<typeof GitHubCodexReviewSchema>>;
  readonly reactionsHasNextPage: boolean;
  readonly reviewsHasNextPage: boolean;
  readonly nextReactionsCursor: string | null;
  readonly nextReviewsCursor: string | null;
}

export interface GitHubPullRequestCoordinates {
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
}

export function parseGitHubPullRequestUrl(url: string): GitHubPullRequestCoordinates | null {
  try {
    const parsed = new URL(url);
    const [owner, repository, pullSegment, numberSegment] = parsed.pathname
      .split("/")
      .filter(Boolean);
    const number = Number(numberSegment);
    if (
      parsed.hostname.toLowerCase() !== "github.com" ||
      !owner ||
      !repository ||
      pullSegment !== "pull" ||
      !Number.isSafeInteger(number) ||
      number <= 0
    ) {
      return null;
    }
    return { owner, repository, number };
  } catch {
    return null;
  }
}

function isCodexLogin(login: string | undefined): boolean {
  return login !== undefined && CODEX_REVIEW_LOGINS.has(login.toLowerCase());
}

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function reviewedCommit(body: string): string | null {
  return REVIEWED_COMMIT_PATTERN.exec(body)?.[1]?.toLowerCase() ?? null;
}

function commitMatchesHead(commit: string, headRefOid: string): boolean {
  const head = headRefOid.toLowerCase();
  return head.startsWith(commit) || commit.startsWith(head);
}

export function resolveGitHubCodexReviewPages(
  pages: ReadonlyArray<GitHubCodexReviewPage>,
): AutomatedReviewSignal | null {
  const firstPage = pages[0];
  if (!firstPage) return null;
  const headUpdatedAt = Math.max(
    Number.NEGATIVE_INFINITY,
    ...pages.map((page) => timestamp(page.headUpdatedAt)),
  );
  const candidates: Array<AutomatedReviewSignal & { readonly observedAt: number }> = [];

  for (const page of pages) {
    for (const review of page.reviews) {
      if (!isCodexLogin(review.author?.login) || !review.body.includes("Codex Review")) continue;
      const observedAt = timestamp(review.submittedAt);
      const reviewedHead = reviewedCommit(review.body);
      const isCurrent = reviewedHead
        ? commitMatchesHead(reviewedHead, firstPage.headRefOid)
        : observedAt >= headUpdatedAt;
      candidates.push({
        provider: "codex",
        state: isCurrent ? "feedback" : "stale",
        observedAt,
      });
    }

    for (const reaction of page.reactions) {
      if (!isCodexLogin(reaction.user?.login)) continue;
      const state =
        reaction.content === "EYES"
          ? "reviewing"
          : reaction.content === "THUMBS_UP"
            ? "passed"
            : null;
      if (state === null) continue;
      const observedAt = timestamp(reaction.createdAt);
      candidates.push({
        provider: "codex",
        state: observedAt >= headUpdatedAt ? state : "stale",
        observedAt,
      });
    }
  }

  const latest = candidates.toSorted((left, right) => right.observedAt - left.observedAt)[0];
  return latest ? { provider: latest.provider, state: latest.state } : null;
}

export function decodeGitHubCodexReviewPageJson(
  raw: string,
): Result.Result<GitHubCodexReviewPage | null, Cause.Cause<Schema.SchemaError>> {
  const decoded = decodeGitHubCodexReviewPageResponse(raw);
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure);
  const pullRequest = decoded.success.data.repository?.pullRequest;
  if (!pullRequest) return Result.succeed(null);

  return Result.succeed({
    headRefOid: pullRequest.headRefOid,
    headUpdatedAt: pullRequest.headUpdates.updatedAt,
    reactions: pullRequest.reactions?.nodes ?? [],
    reviews: pullRequest.reviews?.nodes ?? [],
    reactionsHasNextPage: pullRequest.reactions?.pageInfo.hasNextPage ?? false,
    reviewsHasNextPage: pullRequest.reviews?.pageInfo.hasNextPage ?? false,
    nextReactionsCursor:
      pullRequest.reactions?.pageInfo.hasNextPage === true
        ? pullRequest.reactions.pageInfo.endCursor
        : null,
    nextReviewsCursor:
      pullRequest.reviews?.pageInfo.hasNextPage === true
        ? pullRequest.reviews.pageInfo.endCursor
        : null,
  });
}

// A commit's own timestamp can predate when it became the PR head. Restricting
// the timeline to head-changing items gives reactions a head-specific cutoff.
export const CODEX_REVIEW_QUERY =
  "query($owner:String!,$name:String!,$number:Int!,$reactionsCursor:String,$reviewsCursor:String,$includeReactions:Boolean!,$includeReviews:Boolean!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid headUpdates:timelineItems(last:1,itemTypes:[PULL_REQUEST_COMMIT,HEAD_REF_FORCE_PUSHED_EVENT,HEAD_REF_RESTORED_EVENT]){updatedAt} reactions(first:100,after:$reactionsCursor) @include(if:$includeReactions){pageInfo{hasNextPage endCursor} nodes{content createdAt user{login}}} reviews(first:100,after:$reviewsCursor) @include(if:$includeReviews){pageInfo{hasNextPage endCursor} nodes{author{login} body submittedAt}}}}}";

export class GitHubCodexReviewDecodeError extends Error {
  readonly _tag = "GitHubCodexReviewDecodeError";
}

/**
 * Public Codex review activity for one pull request. Both reaction and review
 * connections are exhausted before an empty result becomes "No signal".
 */
export const fetchGitHubCodexReview = (input: {
  readonly graphql: GitHubApi.GitHubApi["Service"]["graphql"];
  readonly host: string;
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
}): Effect.Effect<
  AutomatedReviewSignal | null,
  GitHubApi.GitHubApiError | GitHubCodexReviewDecodeError
> =>
  Effect.gen(function* () {
    const pages: GitHubCodexReviewPage[] = [];
    const seenReactionsCursors = new Set<string>();
    const seenReviewsCursors = new Set<string>();
    let reactionsCursor: string | null = null;
    let reviewsCursor: string | null = null;
    let includeReactions = true;
    let includeReviews = true;

    while (includeReactions || includeReviews) {
      const raw = yield* input.graphql({
        host: input.host,
        operation: "getCodexReview",
        query: CODEX_REVIEW_QUERY,
        variables: {
          owner: input.owner,
          name: input.repository,
          number: input.number,
          includeReactions,
          includeReviews,
          ...(reactionsCursor ? { reactionsCursor } : {}),
          ...(reviewsCursor ? { reviewsCursor } : {}),
        },
      });
      const decoded = decodeGitHubCodexReviewPageJson(raw);
      if (!Result.isSuccess(decoded)) {
        return yield* Effect.fail(
          new GitHubCodexReviewDecodeError("Codex review response could not be decoded."),
        );
      }
      const page = decoded.success;
      if (page === null) return null;
      if (pages[0] && pages[0].headRefOid !== page.headRefOid) {
        return yield* Effect.fail(
          new GitHubCodexReviewDecodeError(
            "Pull request head changed during Codex activity pagination.",
          ),
        );
      }
      pages.push(page);

      if (includeReactions) {
        const nextCursor = page.nextReactionsCursor;
        if (page.reactionsHasNextPage && (nextCursor === null || seenReactionsCursors.has(nextCursor))) {
          return yield* Effect.fail(
            new GitHubCodexReviewDecodeError("GitHub reaction pagination did not advance."),
          );
        }
        if (nextCursor !== null) seenReactionsCursors.add(nextCursor);
        reactionsCursor = nextCursor;
        includeReactions = page.reactionsHasNextPage;
      }

      if (includeReviews) {
        const nextCursor = page.nextReviewsCursor;
        if (page.reviewsHasNextPage && (nextCursor === null || seenReviewsCursors.has(nextCursor))) {
          return yield* Effect.fail(
            new GitHubCodexReviewDecodeError("GitHub review pagination did not advance."),
          );
        }
        if (nextCursor !== null) seenReviewsCursors.add(nextCursor);
        reviewsCursor = nextCursor;
        includeReviews = page.reviewsHasNextPage;
      }
    }

    return resolveGitHubCodexReviewPages(pages);
  });
