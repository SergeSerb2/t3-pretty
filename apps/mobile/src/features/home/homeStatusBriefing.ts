import type { ThreadListV2Status } from "../threads/threadListV2";

export interface HomeStatusCounts {
  readonly live: number;
  readonly needsAttention: number;
  readonly inMotion: number;
  readonly ready: number;
  readonly queued: number;
  readonly snoozed: number;
  readonly settled: number;
}

export interface HomeStatusBriefing {
  readonly title: string;
  readonly detail: string;
  readonly sectionLabel: "Live matches" | "Live work";
  readonly counts: HomeStatusCounts;
  readonly isPending: boolean;
  readonly total: number | null;
}

const NEEDS_ATTENTION = new Set<ThreadListV2Status>(["approval", "input", "failed"]);

export function deriveHomeStatusCounts(input: {
  readonly liveStatuses: ReadonlyArray<ThreadListV2Status>;
  readonly queued: number;
  readonly snoozed: number;
  readonly settled: number;
}): HomeStatusCounts {
  let needsAttention = 0;
  let inMotion = 0;
  let ready = 0;

  for (const status of input.liveStatuses) {
    if (NEEDS_ATTENTION.has(status)) {
      needsAttention += 1;
    } else if (status === "working") {
      inMotion += 1;
    } else {
      ready += 1;
    }
  }

  return {
    live: input.liveStatuses.length,
    needsAttention,
    inMotion,
    ready,
    queued: input.queued,
    snoozed: input.snoozed,
    settled: input.settled,
  };
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function buildHomeStatusBriefing(
  counts: HomeStatusCounts,
  searchQuery: string,
  options: { readonly searchPending?: boolean } = {},
): HomeStatusBriefing {
  const query = searchQuery.trim();
  const total = counts.live + counts.queued + counts.snoozed + counts.settled;

  if (query.length > 0 && options.searchPending === true) {
    return {
      title: "Searching your workspace",
      detail: `Looking for “${query}” across live work and history.`,
      sectionLabel: "Live matches",
      counts,
      isPending: true,
      total: null,
    };
  }

  if (query.length > 0) {
    return {
      title: countLabel(total, "match", "matches"),
      detail: `Showing results for “${query}” across live work and history.`,
      sectionLabel: "Live matches",
      counts,
      isPending: false,
      total,
    };
  }

  if (counts.needsAttention > 0) {
    return {
      title:
        counts.needsAttention === 1
          ? "1 thread needs your attention"
          : `${counts.needsAttention} threads need your attention`,
      detail: "Review approvals, questions, and failed work first.",
      sectionLabel: "Live work",
      counts,
      isPending: false,
      total,
    };
  }

  if (counts.inMotion > 0) {
    return {
      title: `${countLabel(counts.inMotion, "thread")} in motion`,
      detail: "Agents are working. Nothing is waiting on you.",
      sectionLabel: "Live work",
      counts,
      isPending: false,
      total,
    };
  }

  if (counts.queued > 0) {
    return {
      title: `${countLabel(counts.queued, "task")} waiting to send`,
      detail: "Queued tasks will leave when their environments reconnect.",
      sectionLabel: "Live work",
      counts,
      isPending: false,
      total,
    };
  }

  if (counts.live > 0) {
    return {
      title: `${countLabel(counts.live, "thread")} ready`,
      detail: "No approvals, questions, or failures need attention.",
      sectionLabel: "Live work",
      counts,
      isPending: false,
      total,
    };
  }

  if (counts.snoozed > 0) {
    return {
      title: `${countLabel(counts.snoozed, "thread")} paused`,
      detail: "Snoozed work will return on schedule.",
      sectionLabel: "Live work",
      counts,
      isPending: false,
      total,
    };
  }

  if (counts.settled > 0) {
    return {
      title: "All clear",
      detail: "Nothing is active or waiting. Recent work remains below.",
      sectionLabel: "Live work",
      counts,
      isPending: false,
      total,
    };
  }

  return {
    title: "Ready for a new task",
    detail: "Choose a project and start when you’re ready.",
    sectionLabel: "Live work",
    counts,
    isPending: false,
    total,
  };
}

export function countDistinctHomeScopeProjects(input: {
  readonly catalogProjectKeys: ReadonlyArray<string>;
  readonly workProjectKeys: ReadonlyArray<string>;
}): number {
  return new Set([...input.catalogProjectKeys, ...input.workProjectKeys]).size;
}

export function homeBriefingScopeLabel(input: {
  readonly connectedEnvironmentCount: number;
  readonly projectCount: number;
  readonly selectedEnvironmentLabel: string | null;
  readonly selectedProjectTitle: string | null;
}): string {
  if (input.selectedProjectTitle !== null) {
    return input.selectedProjectTitle;
  }

  const projects = countLabel(input.projectCount, "project");
  if (input.selectedEnvironmentLabel !== null) {
    return `${input.selectedEnvironmentLabel} · ${projects}`;
  }

  if (input.connectedEnvironmentCount === 0) {
    return projects;
  }

  return `${countLabel(input.connectedEnvironmentCount, "connected environment")} · ${projects}`;
}
