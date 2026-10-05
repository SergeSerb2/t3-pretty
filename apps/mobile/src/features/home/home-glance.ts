import { resolveThreadListV2Badge, type ThreadListV2Badge } from "../threads/threadListV2";

export interface HomeGlanceSummary {
  /** The most urgent state as a sentence, or "All caught up". */
  readonly headline: string;
  /** The remaining states, e.g. "3 working · 1 done". */
  readonly detail: string | null;
}

interface GlanceGroup {
  readonly badges: ReadonlyArray<ThreadListV2Badge>;
  readonly headline: (count: number) => string;
  readonly detail: (count: number) => string;
}

const threads = (count: number) => (count === 1 ? "1 thread" : `${count} threads`);

// Attention order: requests first, then failures, then work in motion.
const GLANCE_GROUPS: ReadonlyArray<GlanceGroup> = [
  {
    badges: ["approval", "input"],
    headline: (count) => `${threads(count)} ${count === 1 ? "needs" : "need"} you`,
    detail: (count) => `${count} ${count === 1 ? "needs" : "need"} you`,
  },
  {
    badges: ["failed"],
    headline: (count) => `${threads(count)} failed`,
    detail: (count) => `${count} failed`,
  },
  {
    badges: ["limited"],
    headline: (count) =>
      count === 1 ? "1 thread hit a usage limit" : `${count} threads hit usage limits`,
    detail: (count) => `${count} limited`,
  },
  {
    badges: ["working"],
    headline: (count) => `${threads(count)} working`,
    detail: (count) => `${count} working`,
  },
  {
    badges: ["monitoring"],
    headline: (count) => `${threads(count)} monitoring`,
    detail: (count) => `${count} monitoring`,
  },
  {
    badges: ["done"],
    headline: (count) => `${threads(count)} done`,
    detail: (count) => `${count} done`,
  },
];

/**
 * Summarizes Home's active cards in the words their status labels use, so
 * the glance never claims a state the cards below do not show.
 */
export function summarizeHomeGlance(
  cards: Iterable<Parameters<typeof resolveThreadListV2Badge>[0]>,
): HomeGlanceSummary {
  const counts = new Map<ThreadListV2Badge, number>();
  for (const thread of cards) {
    const badge = resolveThreadListV2Badge(thread);
    if (badge !== null) counts.set(badge, (counts.get(badge) ?? 0) + 1);
  }
  const present = GLANCE_GROUPS.flatMap((group) => {
    const count = group.badges.reduce((sum, badge) => sum + (counts.get(badge) ?? 0), 0);
    return count > 0 ? [{ group, count }] : [];
  });
  const [lead, ...rest] = present;
  if (lead === undefined) return { headline: "All caught up", detail: null };
  return {
    headline: lead.group.headline(lead.count),
    detail:
      rest.length > 0 ? rest.map(({ group, count }) => group.detail(count)).join(" · ") : null,
  };
}
