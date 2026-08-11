import { describe, expect, it } from "vite-plus/test";

import { presentPullRequestReactions } from "./pullRequestReactions.ts";

describe("presentPullRequestReactions", () => {
  it("returns nothing when the host reported no one reacting", () => {
    expect(presentPullRequestReactions(undefined)).toEqual([]);
    expect(presentPullRequestReactions([])).toEqual([]);
  });

  it("keeps GitHub's order so a thumbs-up is not buried behind eyes", () => {
    expect(
      presentPullRequestReactions([
        { content: "eyes", count: 1 },
        { content: "thumbs_up", count: 2 },
        { content: "heart", count: 1 },
      ]).map((reaction) => [reaction.content, reaction.emoji, reaction.count]),
    ).toEqual([
      ["thumbs_up", "👍", 2],
      ["heart", "❤️", 1],
      ["eyes", "👀", 1],
    ]);
  });
});
