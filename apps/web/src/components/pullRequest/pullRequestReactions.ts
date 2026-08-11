import type { PullRequestReaction, PullRequestReactionContent } from "@t3tools/contracts";

/**
 * GitHub's own order, so a thumbs-up that means Codex finished sits where a reader of the host
 * page would look for it rather than jumping to the end of an arrival-order row.
 */
const REACTION_ORDER: ReadonlyArray<PullRequestReactionContent> = [
  "thumbs_up",
  "thumbs_down",
  "laugh",
  "hooray",
  "confused",
  "heart",
  "rocket",
  "eyes",
];

const REACTION_PRESENTATION: Record<
  PullRequestReactionContent,
  { readonly emoji: string; readonly label: string }
> = {
  thumbs_up: { emoji: "👍", label: "Thumbs up" },
  thumbs_down: { emoji: "👎", label: "Thumbs down" },
  laugh: { emoji: "😄", label: "Laugh" },
  hooray: { emoji: "🎉", label: "Hooray" },
  confused: { emoji: "😕", label: "Confused" },
  heart: { emoji: "❤️", label: "Heart" },
  rocket: { emoji: "🚀", label: "Rocket" },
  eyes: { emoji: "👀", label: "Eyes" },
};

export interface PresentedPullRequestReaction {
  readonly content: PullRequestReactionContent;
  readonly emoji: string;
  readonly label: string;
  readonly count: number;
}

export function presentPullRequestReactions(
  reactions: ReadonlyArray<PullRequestReaction> | undefined,
): ReadonlyArray<PresentedPullRequestReaction> {
  if (reactions === undefined || reactions.length === 0) return [];
  const counts = new Map<PullRequestReactionContent, number>();
  for (const reaction of reactions) {
    counts.set(reaction.content, Math.max(counts.get(reaction.content) ?? 0, reaction.count));
  }
  return REACTION_ORDER.flatMap((content) => {
    const count = counts.get(content);
    if (count === undefined || count <= 0) return [];
    return [{ content, count, ...REACTION_PRESENTATION[content] }];
  });
}
