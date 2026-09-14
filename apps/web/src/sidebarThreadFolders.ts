import type { SidebarProjectSortOrder } from "@t3tools/contracts/settings";
import {
  nestThreadsByPullRequest,
  type ThreadPullRequestNestInput,
} from "@t3tools/shared/threadPullRequestNesting";

type FolderSection = "pinned" | "active" | "snoozed" | "settled";

export interface SidebarFolderThread<T> {
  readonly thread: T;
  readonly children: readonly T[];
  readonly pullRequestKey: string | null;
}

export interface SidebarProjectFolder<T> {
  readonly projectKey: string;
  readonly threads: readonly SidebarFolderThread<T>[];
}

export type SidebarFolderListItem<T> =
  | { readonly kind: "folder"; readonly projectKey: string; readonly section: FolderSection }
  | {
      readonly kind: "thread";
      readonly thread: T;
      readonly section: FolderSection;
      readonly nest: "parent" | "child" | null;
      readonly pullRequestKey: string | null;
      readonly childCount: number;
      readonly childKeys: readonly string[];
    };

export function sidebarFolderId(section: FolderSection, projectKey: string): string {
  return `sidebar-folder-${section}-${projectKey}`;
}

export function groupSectionThreadsIntoProjectFolders<T extends ThreadPullRequestNestInput>(input: {
  readonly threads: readonly T[];
  readonly projectKeyOf: (thread: T) => string | null;
  readonly projectSortOrder: SidebarProjectSortOrder;
  readonly projectOrder?: readonly string[];
  readonly getActivityTimestamp: (thread: T) => number;
}): SidebarProjectFolder<T>[] {
  const threadsByProject = new Map<string, T[]>();
  const projectOrderSeen: string[] = [];
  for (const thread of input.threads) {
    const projectKey = input.projectKeyOf(thread) ?? "unknown";
    const existing = threadsByProject.get(projectKey);
    if (existing) {
      existing.push(thread);
    } else {
      threadsByProject.set(projectKey, [thread]);
      projectOrderSeen.push(projectKey);
    }
  }

  const keys = [...threadsByProject.keys()];
  if (input.projectSortOrder === "manual") {
    const preferred = input.projectOrder ?? [];
    keys.sort((left, right) => {
      const leftRank = preferred.indexOf(left);
      const rightRank = preferred.indexOf(right);
      const leftOrder = leftRank === -1 ? Number.POSITIVE_INFINITY : leftRank;
      const rightOrder = rightRank === -1 ? Number.POSITIVE_INFINITY : rightRank;
      return (
        leftOrder - rightOrder || projectOrderSeen.indexOf(left) - projectOrderSeen.indexOf(right)
      );
    });
  } else {
    keys.sort((left, right) => {
      const leftThreads = threadsByProject.get(left) ?? [];
      const rightThreads = threadsByProject.get(right) ?? [];
      const leftStamp = leftThreads.reduce(
        (latest, thread) => Math.max(latest, input.getActivityTimestamp(thread)),
        Number.NEGATIVE_INFINITY,
      );
      const rightStamp = rightThreads.reduce(
        (latest, thread) => Math.max(latest, input.getActivityTimestamp(thread)),
        Number.NEGATIVE_INFINITY,
      );
      return rightStamp === leftStamp ? left.localeCompare(right) : rightStamp > leftStamp ? 1 : -1;
    });
  }

  return keys.map((projectKey) => ({
    projectKey,
    threads: nestThreadsByPullRequest(threadsByProject.get(projectKey) ?? []).map((nest) => ({
      thread: nest.parent,
      children: nest.children,
      pullRequestKey: nest.pullRequestKey,
    })),
  }));
}

export function flattenSectionFolders<T>(input: {
  readonly folders: readonly SidebarProjectFolder<T>[];
  readonly section: FolderSection;
  readonly showProjectFolders: boolean;
  readonly isProjectExpanded: (projectKey: string) => boolean;
  readonly isPrNestExpanded: (pullRequestKey: string) => boolean;
  readonly activeThreadKey: string | null;
  readonly threadKeyOf: (thread: T) => string;
}): SidebarFolderListItem<T>[] {
  const items: SidebarFolderListItem<T>[] = [];
  for (const folder of input.folders) {
    if (input.showProjectFolders) {
      items.push({ kind: "folder", projectKey: folder.projectKey, section: input.section });
    }
    const projectExpanded = !input.showProjectFolders || input.isProjectExpanded(folder.projectKey);
    for (const nest of folder.threads) {
      const parentKey = input.threadKeyOf(nest.thread);
      const childKeys = nest.children.map((child) => input.threadKeyOf(child));
      const nestContainsActive =
        input.activeThreadKey !== null &&
        (parentKey === input.activeThreadKey || childKeys.includes(input.activeThreadKey));
      if (!projectExpanded && !nestContainsActive) continue;

      const nestExpanded =
        nest.pullRequestKey === null || input.isPrNestExpanded(nest.pullRequestKey);
      const showParent =
        projectExpanded || parentKey === input.activeThreadKey || nestContainsActive;
      if (showParent) {
        items.push({
          kind: "thread",
          thread: nest.thread,
          section: input.section,
          nest: nest.children.length > 0 ? "parent" : null,
          pullRequestKey: nest.pullRequestKey,
          childCount: nest.children.length,
          childKeys,
        });
      }
      const showAllChildren = projectExpanded && nestExpanded;
      for (const child of nest.children) {
        const childKey = input.threadKeyOf(child);
        if (showAllChildren || childKey === input.activeThreadKey) {
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
  }
  return items;
}

export function prNestExpansionKey(pullRequestKey: string): string {
  return `pr:${pullRequestKey}`;
}
