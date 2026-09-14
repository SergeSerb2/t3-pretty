import type { ThreadPullRequestLink } from "@t3tools/contracts";

import {
  resolveThreadCurrentPullRequestLink,
  threadPullRequestKeyOf,
} from "./threadPullRequests.ts";

export interface ThreadPullRequestNestInput {
  readonly id: string;
  readonly createdAt: string;
  readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink> | undefined;
}

export interface ThreadPullRequestNest<T> {
  readonly parent: T;
  readonly children: readonly T[];
  readonly pullRequestKey: string | null;
}

export interface OpenProjectPullRequest {
  readonly key: string;
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly url: string;
  readonly title: string | null;
  readonly headBranch: string | null;
  readonly linkedAt: string;
}

function currentPullRequestLink(thread: ThreadPullRequestNestInput): ThreadPullRequestLink | null {
  return resolveThreadCurrentPullRequestLink(thread.pullRequests ?? []);
}

function nestSortKey(thread: ThreadPullRequestNestInput, link: ThreadPullRequestLink): string {
  return `${link.linkedAt}\0${thread.createdAt}\0${thread.id}`;
}

/**
 * Groups threads that share a current pull request. The parent is the
 * oldest-linked thread in this set (earliest `linkedAt`, then `createdAt`).
 * Input order is preserved for parents and for children. A thread with no
 * current PR, or the only thread on a PR, is a nest with no children.
 */
export function nestThreadsByPullRequest<T extends ThreadPullRequestNestInput>(
  threads: readonly T[],
): ThreadPullRequestNest<T>[] {
  const linkByIndex: Array<ThreadPullRequestLink | null> = [];
  const membersByKey = new Map<string, number[]>();
  for (let index = 0; index < threads.length; index += 1) {
    const link = currentPullRequestLink(threads[index]!);
    linkByIndex.push(link);
    if (link === null) continue;
    const key = threadPullRequestKeyOf(link);
    const members = membersByKey.get(key);
    if (members) members.push(index);
    else membersByKey.set(key, [index]);
  }

  const parentIndexByKey = new Map<string, number>();
  const childIndexesByParent = new Map<number, number[]>();
  for (const [key, members] of membersByKey) {
    if (members.length < 2) continue;
    let parentIndex = members[0]!;
    let parentSort = nestSortKey(threads[parentIndex]!, linkByIndex[parentIndex]!);
    for (const index of members.slice(1)) {
      const sort = nestSortKey(threads[index]!, linkByIndex[index]!);
      if (sort < parentSort) {
        parentIndex = index;
        parentSort = sort;
      }
    }
    parentIndexByKey.set(key, parentIndex);
    childIndexesByParent.set(
      parentIndex,
      members.filter((index) => index !== parentIndex),
    );
  }

  const nests: ThreadPullRequestNest<T>[] = [];
  const emitted = new Set<number>();
  for (let index = 0; index < threads.length; index += 1) {
    if (emitted.has(index)) continue;
    const link = linkByIndex[index];
    const key = link == null ? null : threadPullRequestKeyOf(link);
    const parentIndex = key === null ? undefined : parentIndexByKey.get(key);
    if (parentIndex !== undefined && parentIndex !== index) continue;
    const childIndexes = childIndexesByParent.get(index) ?? [];
    for (const childIndex of childIndexes) emitted.add(childIndex);
    emitted.add(index);
    nests.push({
      parent: threads[index]!,
      children: childIndexes.map((childIndex) => threads[childIndex]!),
      pullRequestKey: childIndexes.length > 0 ? key : null,
    });
  }
  return nests;
}

/** Open PRs already linked on these threads, newest link first. */
export function collectOpenProjectPullRequests(
  threads: readonly ThreadPullRequestNestInput[],
): OpenProjectPullRequest[] {
  const byKey = new Map<string, OpenProjectPullRequest>();
  for (const thread of threads) {
    const link = currentPullRequestLink(thread);
    if (link === null) continue;
    if (link.snapshot !== null && link.snapshot.state !== "open") continue;
    const key = threadPullRequestKeyOf(link);
    const existing = byKey.get(key);
    if (existing !== undefined && existing.linkedAt >= link.linkedAt) continue;
    byKey.set(key, {
      key,
      host: link.host,
      repository: link.repository,
      number: link.number,
      url: link.url,
      title: link.snapshot?.title ?? null,
      headBranch: link.snapshot?.headBranch ?? null,
      linkedAt: link.linkedAt,
    });
  }
  const collected = [...byKey.values()];
  collected.sort((left, right) => {
    const byLinked = right.linkedAt < left.linkedAt ? -1 : right.linkedAt > left.linkedAt ? 1 : 0;
    return byLinked || left.key.localeCompare(right.key);
  });
  return collected;
}
