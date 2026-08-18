import * as Effect from "effect/Effect";
import type { PullRequestCapabilities, PullRequestViewerPermissions } from "@t3tools/contracts";

import * as OriginPullRequestCli from "./OriginPullRequestCli.ts";
import {
  PullRequestProviderError,
  type PullRequestProviderFailure,
  type PullRequestProviderApi,
} from "./PullRequestProvider.ts";

const CAPABILITIES: PullRequestCapabilities = {
  diff: true,
  comment: true,
  actions: [
    "merge",
    "ready",
    "draft",
    "close",
    "reopen",
    "enable-auto-merge",
    "disable-auto-merge",
  ],
  mergeMethods: ["merge", "squash"],
  search: false,
  reactions: false,
  review: {
    inlineComment: false,
    reply: true,
    resolve: true,
    verdicts: ["comment", "approve"],
  },
  reviewers: { request: false, listCandidates: false },
  edit: { changeRequest: true, comment: false },
};

const VIEWER_PERMISSIONS: PullRequestViewerPermissions = {
  actions: CAPABILITIES.actions,
  comment: true,
  resolve: true,
  verdicts: CAPABILITIES.review.verdicts,
  requestReviewers: false,
};

export function originProviderFailure(
  error: OriginPullRequestCli.OriginPullRequestCliError,
): PullRequestProviderFailure {
  if (error._tag === "OriginCliUnavailableError") return { reason: "missing-tool" };
  if (error._tag === "OriginCliAuthenticationError") return { reason: "unauthenticated" };
  if (error._tag === "OriginCliRateLimitError") return { reason: "rate-limited" };
  return { reason: "failed" };
}

export const make = Effect.gen(function* () {
  const cli = yield* OriginPullRequestCli.OriginPullRequestCli;

  const fail = (operation: string) => (error: OriginPullRequestCli.OriginPullRequestCliError) =>
    new PullRequestProviderError({
      provider: "origin",
      operation,
      ...originProviderFailure(error),
      detail: error.detail,
      cause: error,
    });

  const unsupported = (operation: string, detail: string) =>
    Effect.fail(
      new PullRequestProviderError({
        provider: "origin",
        operation,
        reason: "failed",
        detail,
      }),
    );

  const provider: PullRequestProviderApi = {
    kind: "origin",
    capabilities: CAPABILITIES,

    getViewer: (input) =>
      cli.getViewerUsername({ cwd: input.cwd }).pipe(Effect.mapError(fail("getViewer"))),

    listChangeRequests: (input) =>
      cli
        .listPullRequests({
          cwd: input.cwd,
          repository: input.repository,
          state: input.state,
          involvement: input.involvement,
          viewer: input.viewer,
          limit: input.limit,
          query: input.query,
          cursor: input.cursor,
        })
        .pipe(Effect.mapError(fail("listChangeRequests"))),

    getChangeRequest: (input) =>
      cli.getPullRequestDetail(input).pipe(Effect.mapError(fail("getChangeRequest"))),

    getChangeRequestActivity: (input) =>
      cli.getPullRequestActivity(input).pipe(Effect.mapError(fail("getChangeRequestActivity"))),

    getViewerPermissions: () => Effect.succeed(VIEWER_PERMISSIONS),

    getDiff: (input) => cli.getPullRequestDiff(input).pipe(Effect.mapError(fail("getDiff"))),

    runAction: (input) =>
      cli
        .runAction({
          cwd: input.cwd,
          repository: input.repository,
          number: input.number,
          action: input.action,
          ...(input.mergeMethod === undefined ? {} : { mergeMethod: input.mergeMethod }),
        })
        .pipe(Effect.mapError(fail("runAction"))),

    updateChangeRequest: (input) =>
      cli
        .updatePullRequest({
          cwd: input.cwd,
          repository: input.repository,
          number: input.number,
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.body === undefined ? {} : { body: input.body }),
        })
        .pipe(Effect.mapError(fail("updateChangeRequest"))),

    comment: (input) => cli.comment(input).pipe(Effect.mapError(fail("comment"))),

    submitReview: (input) =>
      cli
        .submitReview({
          cwd: input.cwd,
          repository: input.repository,
          number: input.number,
          verdict: input.verdict,
          body: input.body,
        })
        .pipe(Effect.mapError(fail("submitReview"))),

    listReviewerCandidates: () =>
      unsupported("listReviewerCandidates", "Origin has no public reviewer-candidate API yet."),

    setReviewerRequest: () =>
      unsupported("setReviewerRequest", "Origin has no public reviewer-request API yet."),

    replyToThread: (input) => cli.replyToThread(input).pipe(Effect.mapError(fail("replyToThread"))),

    setReaction: () => unsupported("setReaction", "Origin pull requests do not support reactions."),

    setThreadResolution: (input) =>
      cli.setThreadResolution(input).pipe(Effect.mapError(fail("setThreadResolution"))),
  };

  return provider;
});
