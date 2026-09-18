import type { ThreadPullRequestLink } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  collectOpenProjectPullRequests,
  nestThreadsByPullRequest,
} from "./threadPullRequestNesting.ts";

beforeEach(() => {
  const methods = ["toSorted", "toReversed", "toSpliced"] as const;
  const descriptors = methods.map((method) =>
    Object.getOwnPropertyDescriptor(Array.prototype, method),
  );
  for (const method of methods) Reflect.deleteProperty(Array.prototype, method);
  return () => {
    for (const [index, method] of methods.entries()) {
      const descriptor = descriptors[index];
      if (descriptor) Reflect.defineProperty(Array.prototype, method, descriptor);
    }
  };
});

function link(
  number: number,
  input: Partial<Omit<ThreadPullRequestLink, "number">> = {},
): ThreadPullRequestLink {
  return {
    host: "github.com",
    repository: "pingdotgg/t3code",
    number,
    url: `https://github.com/pingdotgg/t3code/pull/${number}`,
    source: "manual",
    linkedAt: `2026-01-01T00:00:${String(number).padStart(2, "0")}.000Z`,
    snapshot: {
      state: "open",
      title: `Change ${number}`,
      headBranch: `feature-${number}`,
      baseBranch: "main",
      isDraft: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
      syncedAt: "2026-01-01T00:00:00.000Z",
    },
    stack: null,
    ...input,
  };
}

function thread(
  id: string,
  pullRequests: ThreadPullRequestLink[] = [],
  createdAt = "2026-01-02T00:00:00.000Z",
) {
  return { id, createdAt, pullRequests };
}

describe("nestThreadsByPullRequest", () => {
  it("leaves unmatched threads as roots", () => {
    const lone = thread("a");
    const other = thread("b", [link(2)]);
    expect(nestThreadsByPullRequest([lone, other])).toEqual([
      { parent: lone, children: [], pullRequestKey: null },
      { parent: other, children: [], pullRequestKey: null },
    ]);
  });

  it("nests later-linked threads under the earliest linkedAt", () => {
    const review = thread("review", [link(12, { linkedAt: "2026-03-02T00:00:00.000Z" })]);
    const main = thread("main", [link(12, { linkedAt: "2026-03-01T00:00:00.000Z" })]);
    const fix = thread("fix", [link(12, { linkedAt: "2026-03-03T00:00:00.000Z" })]);
    expect(nestThreadsByPullRequest([review, main, fix])).toEqual([
      {
        parent: main,
        children: [review, fix],
        pullRequestKey: "github.com/pingdotgg/t3code#12",
      },
    ]);
  });

  it("keeps a later-created thread as parent when it linked first", () => {
    const olderThread = thread(
      "older",
      [link(4, { linkedAt: "2026-04-02T00:00:00.000Z" })],
      "2026-01-01T00:00:00.000Z",
    );
    const firstLink = thread(
      "first",
      [link(4, { linkedAt: "2026-04-01T00:00:00.000Z" })],
      "2026-03-01T00:00:00.000Z",
    );
    expect(nestThreadsByPullRequest([olderThread, firstLink])[0]?.parent.id).toBe("first");
  });

  it("does not nest across different pull requests", () => {
    const twelve = thread("twelve", [link(12)]);
    const thirteen = thread("thirteen", [link(13)]);
    const nests = nestThreadsByPullRequest([twelve, thirteen]);
    expect(nests.map((nest) => nest.parent.id)).toEqual(["twelve", "thirteen"]);
    expect(nests.every((nest) => nest.children.length === 0)).toBe(true);
  });
});

describe("collectOpenProjectPullRequests", () => {
  it("returns unique open PRs, newest link first", () => {
    const threads = [
      thread("a", [link(12, { linkedAt: "2026-03-01T00:00:00.000Z" })]),
      thread("b", [link(12, { linkedAt: "2026-03-03T00:00:00.000Z" })]),
      thread("c", [
        link(9, {
          linkedAt: "2026-03-02T00:00:00.000Z",
          snapshot: {
            state: "merged",
            title: "Done",
            headBranch: "done",
            baseBranch: "main",
            isDraft: false,
            updatedAt: "2026-03-02T00:00:00.000Z",
            syncedAt: "2026-03-02T00:00:00.000Z",
          },
        }),
      ]),
    ];
    expect(collectOpenProjectPullRequests(threads)).toEqual([
      {
        key: "github.com/pingdotgg/t3code#12",
        host: "github.com",
        repository: "pingdotgg/t3code",
        number: 12,
        url: "https://github.com/pingdotgg/t3code/pull/12",
        title: "Change 12",
        headBranch: "feature-12",
        linkedAt: "2026-03-03T00:00:00.000Z",
      },
    ]);
  });
});
