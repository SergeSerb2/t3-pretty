import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";

/**
 * Environment labels resolve to the machine's friendly name on the server
 * (macOS ComputerName, Linux pretty hostname, else hostname), so a normalized
 * label is the only client-side key for "same machine". Multiple T3 homes on
 * one host (installed app, nightly, dev worktrees) each publish their own
 * environment id under that shared label.
 */
export function environmentMachineKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/gu, " ");
}

export type ConnectionGroupPhase = EnvironmentConnectionPresentation["phase"];

export function connectionPhaseGroupPriority(phase: ConnectionGroupPhase): number {
  switch (phase) {
    case "connected":
      return 0;
    case "connecting":
    case "reconnecting":
      return 1;
    case "available":
      return 2;
    case "offline":
      return 3;
    case "error":
      return 4;
  }
}

/** A connection the user can actually use: live, on its way up, or reachable. */
export function isWorkingConnectionPhase(phase: ConnectionGroupPhase): boolean {
  return connectionPhaseGroupPriority(phase) <= 2;
}

export interface RemoteEnvironmentGroupEntry {
  readonly id: string;
  readonly machineKey: string;
  /** Lower is healthier; only picks the representative of an all-idle group. */
  readonly priority: number;
  /** True when the entry is connected, connecting, or verified reachable. */
  readonly working: boolean;
}

/**
 * Collapses duplicate rows for one machine. Once any entry for the machine is
 * working (a live session or a verified-online relay), every non-working row
 * for that machine is hidden, so stale offline duplicates stop fluffing up the
 * list. When no entry is working a single representative survives, keeping the
 * machine reachable and removable without rendering every duplicate.
 */
export function selectVisibleRemoteEnvironmentIds(
  entries: ReadonlyArray<RemoteEnvironmentGroupEntry>,
): ReadonlySet<string> {
  const groups = new Map<string, Array<RemoteEnvironmentGroupEntry>>();
  for (const entry of entries) {
    const group = groups.get(entry.machineKey);
    if (group) {
      group.push(entry);
    } else {
      groups.set(entry.machineKey, [entry]);
    }
  }

  const visible = new Set<string>();
  for (const group of groups.values()) {
    const working = group.filter((entry) => entry.working);
    if (working.length > 0) {
      for (const entry of working) {
        visible.add(entry.id);
      }
      continue;
    }
    let representative = group[0]!;
    for (const entry of group) {
      if (
        entry.priority < representative.priority ||
        (entry.priority === representative.priority && entry.id < representative.id)
      ) {
        representative = entry;
      }
    }
    visible.add(representative.id);
  }
  return visible;
}
