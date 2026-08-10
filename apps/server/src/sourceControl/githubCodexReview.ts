import * as Cause from "effect/Cause";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type { AutomatedReviewSignal } from "@t3tools/contracts";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";

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
            commits: Schema.Struct({
              nodes: Schema.Array(
                Schema.Struct({
                  commit: Schema.Struct({
                    committedDate: Schema.String,
                  }),
                }),
              ),
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
  readonly latestCommitAt: string | null;
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
  const latestCommitAt = Math.max(
    Number.NEGATIVE_INFINITY,
    ...pages.map((page) => timestamp(page.latestCommitAt)),
  );
  const candidates: Array<AutomatedReviewSignal & { readonly observedAt: number }> = [];

  for (const page of pages) {
    for (const review of page.reviews) {
      if (!isCodexLogin(review.author?.login) || !review.body.includes("Codex Review")) continue;
      const observedAt = timestamp(review.submittedAt);
      const reviewedHead = reviewedCommit(review.body);
      const isCurrent = reviewedHead
        ? commitMatchesHead(reviewedHead, firstPage.headRefOid)
        : observedAt >= latestCommitAt;
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
        state: observedAt >= latestCommitAt ? state : "stale",
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
    latestCommitAt: pullRequest.commits.nodes[0]?.commit.committedDate ?? null,
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
