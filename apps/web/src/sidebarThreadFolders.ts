import {
  nestThreadsByPullRequest,
  type ThreadPullRequestNestInput,
} from "@t3tools/shared/threadPullRequestNesting";

type NestSection = "pinned" | "active" | "snoozed" | "settled";

export interface SidebarNestedListItem<T> {
  readonly kind: "thread";
  readonly thread: T;
  readonly section: NestSection;
  readonly nest: "parent" | "child" | null;
  readonly pullRequestKey: string | null;
  readonly childCount: number;
  readonly childKeys: readonly string[];
}

/**
 * Flatten one sidebar section into rows, nesting later threads on the same
 * pull request under the first-linked one. A collapsed nest still shows the
 * child that is open, so the route never points at a hidden row.
 */
export function flattenNestedThreads<T extends ThreadPullRequestNestInput>(input: {
  readonly threads: readonly T[];
  readonly section: NestSection;
  readonly isPrNestExpanded: (pullRequestKey: string) => boolean;
  readonly activeThreadKey: string | null;
  readonly threadKeyOf: (thread: T) => string;
}): SidebarNestedListItem<T>[] {
  const items: SidebarNestedListItem<T>[] = [];
  for (const nest of nestThreadsByPullRequest(input.threads)) {
    const childKeys = nest.children.map((child) => input.threadKeyOf(child));
    items.push({
      kind: "thread",
      thread: nest.parent,
      section: input.section,
      nest: nest.children.length > 0 ? "parent" : null,
      pullRequestKey: nest.pullRequestKey,
      childCount: nest.children.length,
      childKeys,
    });
    const expanded = nest.pullRequestKey === null || input.isPrNestExpanded(nest.pullRequestKey);
    for (const child of nest.children) {
      const childKey = input.threadKeyOf(child);
      if (expanded || childKey === input.activeThreadKey) {
        items.push({
          kind: "thread",
          thread: child,
          section: input.section,
          nest: "child",
          pullRequestKey: nest.pullRequestKey,
          childCount: 0,
          childKeys: [],
        });
      }
    }
  }
  return items;
}

export function prNestExpansionKey(pullRequestKey: string): string {
  return `pr:${pullRequestKey}`;
}
