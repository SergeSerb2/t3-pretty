import { describe, expect, it } from "@effect/vitest";
import * as Result from "effect/Result";

import {
  decodeGitHubCodexReviewPageJson,
  parseGitHubPullRequestUrl,
  resolveGitHubCodexReviewPages,
} from "./githubCodexReview.ts";

function response(input: {
  readonly head?: string;
  readonly committedAt?: string;
  readonly reactions?: ReadonlyArray<{
    readonly content: string;
    readonly createdAt: string;
    readonly login: string;
  }>;
  readonly reviews?: ReadonlyArray<{
    readonly body: string;
    readonly submittedAt: string;
    readonly login: string;
  }>;
}) {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          headRefOid: input.head ?? "abcdef1234567890",
          commits: {
            nodes: [
              {
                commit: {
                  committedDate: input.committedAt ?? "2026-08-10T05:30:00Z",
                },
              },
            ],
          },
          reactions: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: (input.reactions ?? []).map(({ login, ...reaction }) => ({
              ...reaction,
              user: { login },
            })),
          },
          reviews: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: (input.reviews ?? []).map(({ login, ...review }) => ({
              ...review,
              author: { login },
            })),
          },
        },
      },
    },
  });
}

function decode(raw: string) {
  const result = decodeGitHubCodexReviewPageJson(raw);
  expect(Result.isSuccess(result)).toBe(true);
  if (Result.isFailure(result)) throw new Error("Expected GitHub response to decode");
  return result.success ? resolveGitHubCodexReviewPages([result.success]) : null;
}

describe("parseGitHubPullRequestUrl", () => {
  it("extracts github.com pull request coordinates", () => {
    expect(parseGitHubPullRequestUrl("https://github.com/pingdotgg/t3code/pull/42")).toEqual({
      owner: "pingdotgg",
      repository: "t3code",
      number: 42,
    });
  });

  it("rejects non-GitHub and non-pull-request URLs", () => {
    expect(parseGitHubPullRequestUrl("https://example.com/pingdotgg/t3code/pull/42")).toBeNull();
    expect(parseGitHubPullRequestUrl("https://github.com/pingdotgg/t3code/issues/42")).toBeNull();
  });
});

describe("resolveGitHubCodexReviewPages", () => {
  it("reports the connector eye reaction as reviewing", () => {
    expect(
      decode(
        response({
          reactions: [
            {
              content: "EYES",
              createdAt: "2026-08-10T05:31:00Z",
              login: "chatgpt-codex-connector[bot]",
            },
          ],
        }),
      ),
    ).toEqual({ provider: "codex", state: "reviewing" });
  });

  it("reports the connector thumbs-up as a clean pass", () => {
    expect(
      decode(
        response({
          reactions: [
            {
              content: "THUMBS_UP",
              createdAt: "2026-08-10T05:38:00Z",
              login: "chatgpt-codex-connector[bot]",
            },
          ],
        }),
      ),
    ).toEqual({ provider: "codex", state: "passed" });
  });

  it("reports a Codex review for the current head as feedback", () => {
    expect(
      decode(
        response({
          reviews: [
            {
              body: "### 💡 Codex Review\n\n**Reviewed commit:** `abcdef1234`",
              submittedAt: "2026-08-10T05:39:00Z",
              login: "chatgpt-codex-connector",
            },
          ],
        }),
      ),
    ).toEqual({ provider: "codex", state: "feedback" });
  });

  it("marks a result older than the current head as stale", () => {
    expect(
      decode(
        response({
          reactions: [
            {
              content: "THUMBS_UP",
              createdAt: "2026-08-10T05:29:00Z",
              login: "chatgpt-codex-connector[bot]",
            },
          ],
        }),
      ),
    ).toEqual({ provider: "codex", state: "stale" });
  });

  it("uses Codex's reviewed commit marker to detect stale feedback", () => {
    expect(
      decode(
        response({
          reviews: [
            {
              body: "### 💡 Codex Review\n\n**Reviewed commit:** `0000000000`",
              submittedAt: "2026-08-10T05:39:00Z",
              login: "chatgpt-codex-connector",
            },
          ],
        }),
      ),
    ).toEqual({ provider: "codex", state: "stale" });
  });

  it("prefers the newest public Codex signal", () => {
    expect(
      decode(
        response({
          reactions: [
            {
              content: "EYES",
              createdAt: "2026-08-10T05:40:00Z",
              login: "chatgpt-codex-connector[bot]",
            },
          ],
          reviews: [
            {
              body: "### 💡 Codex Review\n\n**Reviewed commit:** `0000000000`",
              submittedAt: "2026-08-10T05:35:00Z",
              login: "chatgpt-codex-connector",
            },
          ],
        }),
      ),
    ).toEqual({ provider: "codex", state: "reviewing" });
  });

  it("returns null when Codex has left no public signal", () => {
    expect(decode(response({}))).toBeNull();
  });
});
