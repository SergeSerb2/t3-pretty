import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type {
  PullRequestAction,
  PullRequestComment,
  PullRequestCommit,
  PullRequestInvolvement,
  PullRequestListState,
  PullRequestMergeMethod,
  PullRequestReviewThread,
  PullRequestReviewVerdict,
} from "@t3tools/contracts";

import * as OriginCli from "../sourceControl/OriginCli.ts";
import { parseOriginAuthStatus } from "../sourceControl/originAuthStatus.ts";
import {
  decodeOriginListJson,
  decodeOriginViewJson,
  originComments,
  originCommits,
  originReviews,
  originThreads,
  toOriginDetail,
  type OriginListItem,
} from "./originPullRequestJson.ts";
import type {
  ProviderChangeRequestActivity,
  ProviderChangeRequestDetail,
  ProviderChangeRequestPage,
  ProviderDiffSlice,
  ProviderListCursor,
} from "./PullRequestProvider.ts";

export class OriginPullRequestReadError extends Schema.TaggedErrorClass<OriginPullRequestReadError>()(
  "OriginPullRequestReadError",
  {
    command: Schema.Literal("origin"),
    cwd: Schema.String,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return `Origin CLI returned an unreadable ${this.operation} response.`;
  }

  override get message(): string {
    return `Origin CLI failed in ${this.operation}: ${this.detail}`;
  }
}

export class OriginViewerUnavailableError extends Schema.TaggedErrorClass<OriginViewerUnavailableError>()(
  "OriginViewerUnavailableError",
  {
    command: Schema.Literal("origin"),
    cwd: Schema.String,
  },
) {
  get detail(): string {
    return "Origin CLI returned no account for the authenticated user.";
  }

  override get message(): string {
    return `Origin CLI failed in getViewerUsername: ${this.detail}`;
  }
}

export type OriginPullRequestCliError =
  | OriginCli.OriginCliError
  | OriginPullRequestReadError
  | OriginViewerUnavailableError;

const LIST_JSON_FIELDS =
  "number,title,description,headRef,baseRef,author,status,createdAt,updatedAt,mergedAt,closedAt,additions,deletions,changedFiles,url,repo,assignments,mergeability,ciState";
const VIEW_JSON_FIELDS = `${LIST_JSON_FIELDS},comments,threads,commits,reviews,latestReviews`;
const MAX_PAGE_SIZE = 100;

function repoArgs(repository: string): ReadonlyArray<string> {
  return ["-R", repository];
}

function listState(state: PullRequestListState): "open" | "closed" | "merged" | "all" {
  // Origin lists drafts separately from open. T3's "open" includes drafts.
  return state === "open" ? "all" : state;
}

export class OriginPullRequestCli extends Context.Service<
  OriginPullRequestCli,
  {
    readonly getViewerUsername: (input: {
      readonly cwd: string;
    }) => Effect.Effect<string, OriginPullRequestCliError>;

    readonly listPullRequests: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly state: PullRequestListState;
      readonly involvement: PullRequestInvolvement;
      readonly viewer: string;
      readonly limit: number;
      readonly query?: string | undefined;
      readonly cursor?: ProviderListCursor | undefined;
    }) => Effect.Effect<ProviderChangeRequestPage, OriginPullRequestCliError>;

    readonly getPullRequestDetail: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<ProviderChangeRequestDetail, OriginPullRequestCliError>;

    readonly getPullRequestActivity: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<ProviderChangeRequestActivity, OriginPullRequestCliError>;

    readonly getPullRequestDiff: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly number: number;
    }) => Effect.Effect<ProviderDiffSlice, OriginPullRequestCliError>;

    readonly runAction: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly number: number;
      readonly action: PullRequestAction;
      readonly mergeMethod?: PullRequestMergeMethod;
    }) => Effect.Effect<void, OriginPullRequestCliError>;

    readonly updatePullRequest: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly number: number;
      readonly title?: string | undefined;
      readonly body?: string | undefined;
    }) => Effect.Effect<void, OriginPullRequestCliError>;

    readonly comment: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly number: number;
      readonly body: string;
    }) => Effect.Effect<void, OriginPullRequestCliError>;

    readonly submitReview: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly number: number;
      readonly verdict: PullRequestReviewVerdict;
      readonly body: string;
    }) => Effect.Effect<void, OriginPullRequestCliError>;

    readonly replyToThread: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly number: number;
      readonly threadId: string;
      readonly body: string;
    }) => Effect.Effect<void, OriginPullRequestCliError>;

    readonly setThreadResolution: (input: {
      readonly cwd: string;
      readonly repository: string;
      readonly number: number;
      readonly threadId: string;
      readonly resolved: boolean;
    }) => Effect.Effect<void, OriginPullRequestCliError>;
  }
>()("t3/pullRequest/OriginPullRequestCli") {}

function readError(operation: string, cwd: string, cause: unknown): OriginPullRequestReadError {
  return new OriginPullRequestReadError({
    command: "origin",
    cwd,
    operation,
    cause,
  });
}

function filterList(
  items: ReadonlyArray<OriginListItem>,
  input: {
    readonly state: PullRequestListState;
    readonly involvement: PullRequestInvolvement;
    readonly viewer: string;
    readonly query?: string | undefined;
    readonly cursor?: ProviderListCursor | undefined;
    readonly limit: number;
  },
): ProviderChangeRequestPage {
  const viewer = input.viewer.trim().toLowerCase();
  let filtered = items;
  if (input.state === "open") {
    filtered = filtered.filter((item) => item.state === "open");
  }
  if (input.involvement === "reviewing" && viewer.length > 0) {
    filtered = filtered.filter((item) =>
      item.reviewRequestLogins.some((login) => login.toLowerCase() === viewer),
    );
  }
  if (input.query && input.query.trim().length > 0) {
    const query = input.query.trim().toLowerCase();
    filtered = filtered.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.headBranch.toLowerCase().includes(query) ||
        String(item.number).includes(query),
    );
  }
  if (input.cursor) {
    const boundary = Date.parse(input.cursor.updatedBefore);
    if (!Number.isNaN(boundary)) {
      filtered = filtered.filter((item) => item.updatedAtMs <= boundary);
    }
    if (input.cursor.delivered > 0) {
      filtered = filtered.slice(input.cursor.delivered);
    }
  }
  const truncated = filtered.length > input.limit;
  return {
    items: filtered.slice(0, input.limit),
    truncated,
    continues: true,
  };
}

function actionArgs(input: {
  readonly action: PullRequestAction;
  readonly mergeMethod?: PullRequestMergeMethod;
}): ReadonlyArray<string> | null {
  switch (input.action) {
    case "merge":
      return ["pr", "merge", ...(input.mergeMethod === "squash" ? ["--squash"] : ["--merge"])];
    case "close":
      return ["pr", "close"];
    case "reopen":
      return ["pr", "reopen"];
    case "ready":
      return ["pr", "ready"];
    case "draft":
      return ["pr", "ready", "--undo"];
    case "enable-auto-merge":
      return ["pr", "merge", "--auto"];
    case "disable-auto-merge":
      return ["pr", "merge", "--disable-auto"];
    case "update-branch":
      return null;
  }
}

export const make = Effect.gen(function* () {
  const origin = yield* OriginCli.OriginCli;

  return OriginPullRequestCli.of({
    getViewerUsername: (input) =>
      origin.execute({ cwd: input.cwd, args: ["auth", "status"] }).pipe(
        Effect.map((result) => parseOriginAuthStatus(result.stdout).account),
        Effect.flatMap((account) =>
          account
            ? Effect.succeed(account)
            : Effect.fail(new OriginViewerUnavailableError({ command: "origin", cwd: input.cwd })),
        ),
      ),

    listPullRequests: (input) =>
      origin
        .execute({
          cwd: input.cwd,
          args: [
            "pr",
            "list",
            ...repoArgs(input.repository),
            "--state",
            listState(input.state),
            ...(input.involvement === "authored" ? ["--mine"] : []),
            "--limit",
            String(
              Math.min(
                MAX_PAGE_SIZE,
                Math.max(input.limit + 1, (input.cursor?.delivered ?? 0) + input.limit + 1),
              ),
            ),
            "--json",
            LIST_JSON_FIELDS,
          ],
        })
        .pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.flatMap((raw) =>
            raw.length === 0
              ? Effect.succeed({ items: [], truncated: false, continues: true })
              : Effect.sync(() => decodeOriginListJson(raw)).pipe(
                  Effect.flatMap((decoded) => {
                    if (!Result.isSuccess(decoded)) {
                      return Effect.fail(readError("listPullRequests", input.cwd, decoded.failure));
                    }
                    return Effect.succeed(filterList(decoded.success, input));
                  }),
                ),
          ),
        ),

    getPullRequestDetail: (input) =>
      origin
        .execute({
          cwd: input.cwd,
          args: [
            "pr",
            "view",
            String(input.number),
            ...repoArgs(input.repository),
            "--json",
            VIEW_JSON_FIELDS,
          ],
        })
        .pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.flatMap((raw) =>
            Effect.sync(() => decodeOriginViewJson(raw)).pipe(
              Effect.flatMap((decoded) => {
                if (!Result.isSuccess(decoded)) {
                  return Effect.fail(readError("getPullRequestDetail", input.cwd, decoded.failure));
                }
                const detail = toOriginDetail(decoded.success);
                return detail
                  ? Effect.succeed(detail)
                  : Effect.fail(
                      readError(
                        "getPullRequestDetail",
                        input.cwd,
                        new Error("Origin pull request JSON was missing required fields."),
                      ),
                    );
              }),
            ),
          ),
        ),

    getPullRequestActivity: (input) =>
      origin
        .execute({
          cwd: input.cwd,
          args: [
            "pr",
            "view",
            String(input.number),
            ...repoArgs(input.repository),
            "--json",
            "comments,threads,commits,reviews,latestReviews",
          ],
        })
        .pipe(
          Effect.map((result) => result.stdout.trim()),
          Effect.flatMap((raw) =>
            Effect.sync(() => decodeOriginViewJson(raw)).pipe(
              Effect.flatMap((decoded) => {
                if (!Result.isSuccess(decoded)) {
                  return Effect.fail(
                    readError("getPullRequestActivity", input.cwd, decoded.failure),
                  );
                }
                const comments: ReadonlyArray<PullRequestComment> = [
                  ...originComments(decoded.success.comments),
                  ...originReviews(decoded.success.reviews ?? decoded.success.latestReviews),
                ];
                const reviewThreads: ReadonlyArray<PullRequestReviewThread> = originThreads(
                  decoded.success.threads,
                );
                const commits: ReadonlyArray<PullRequestCommit> = originCommits(
                  decoded.success.commits,
                );
                return Effect.succeed({
                  comments,
                  commentCount: comments.length,
                  commentsTruncated: false,
                  reviewThreads,
                  commits,
                } satisfies ProviderChangeRequestActivity);
              }),
            ),
          ),
        ),

    getPullRequestDiff: (input) =>
      origin
        .execute({
          cwd: input.cwd,
          args: ["pr", "diff", String(input.number), ...repoArgs(input.repository), "--patch"],
          maxOutputBytes: 8 * 1024 * 1024,
          timeoutMs: 60_000,
        })
        .pipe(
          Effect.map(
            (result): ProviderDiffSlice => ({
              patch: result.stdout,
              truncated: result.stdoutTruncated,
              nextCursor: null,
            }),
          ),
        ),

    runAction: (input) => {
      const args = actionArgs(input);
      if (args === null) {
        return Effect.fail(
          readError(
            "runAction",
            input.cwd,
            new Error("Origin cannot update a pull request branch from here."),
          ),
        );
      }
      return origin
        .execute({
          cwd: input.cwd,
          args: [...args, String(input.number), ...repoArgs(input.repository)],
        })
        .pipe(Effect.asVoid);
    },

    updatePullRequest: (input) =>
      origin
        .execute({
          cwd: input.cwd,
          args: [
            "pr",
            "edit",
            String(input.number),
            ...repoArgs(input.repository),
            ...(input.title ? ["--title", input.title] : []),
            ...(input.body ? ["--body", input.body] : []),
          ],
        })
        .pipe(Effect.asVoid),

    comment: (input) =>
      origin
        .execute({
          cwd: input.cwd,
          args: [
            "pr",
            "comment",
            String(input.number),
            ...repoArgs(input.repository),
            "--body",
            input.body,
          ],
        })
        .pipe(Effect.asVoid),

    submitReview: (input) =>
      origin
        .execute({
          cwd: input.cwd,
          args: [
            "pr",
            "review",
            String(input.number),
            ...repoArgs(input.repository),
            ...(input.verdict === "approve" ? ["--approve"] : ["--comment"]),
            ...(input.body.trim().length > 0 ? ["--body", input.body] : []),
          ],
        })
        .pipe(Effect.asVoid),

    replyToThread: (input) =>
      origin
        .execute({
          cwd: input.cwd,
          args: [
            "pr",
            "thread",
            "reply",
            input.threadId,
            String(input.number),
            ...repoArgs(input.repository),
            "--body",
            input.body,
          ],
        })
        .pipe(Effect.asVoid),

    setThreadResolution: (input) =>
      origin
        .execute({
          cwd: input.cwd,
          args: [
            "pr",
            "thread",
            input.resolved ? "resolve" : "reopen",
            input.threadId,
            String(input.number),
            ...repoArgs(input.repository),
          ],
        })
        .pipe(Effect.asVoid),
  });
});

export const layer = Layer.effect(OriginPullRequestCli, make);
