import { describe, expect, it } from "vite-plus/test";
import type { RuntimeSubagent } from "./subagentRuntime.ts";
import {
  advanceSubagentActivityLog,
  emptySubagentActivityLog,
  subagentLogEntries,
} from "./subagentActivityLog.ts";

function agent(overrides: Partial<RuntimeSubagent> & { id: string }): RuntimeSubagent {
  return {
    kind: "subagent",
    title: overrides.id,
    role: null,
    model: null,
    effort: null,
    status: "running",
    activationCount: 1,
    usage: null,
    progress: null,
    lastToolName: null,
    result: null,
    error: null,
    outputFile: null,
    parentAgentId: null,
    agentIndex: null,
    phaseIndex: null,
    phaseTitle: null,
    attempt: null,
    workflowName: null,
    phases: [],
    runHandles: null,
    recentActivity: [],
    firstSeenAt: "2026-08-01T10:00:00.000Z",
    startedAt: "2026-08-01T10:00:00.000Z",
    completedAt: null,
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("advanceSubagentActivityLog", () => {
  it("seeds a new agent from its current ring and accumulates later ticks", () => {
    const first = advanceSubagentActivityLog(emptySubagentActivityLog(), [
      agent({
        id: "a1",
        recentActivity: [{ at: "2026-08-01T10:00:01.000Z", summary: "Reading files" }],
      }),
    ]);
    expect(subagentLogEntries(first, "a1").map((entry) => entry.summary)).toEqual([
      "Reading files",
    ]);

    // The stable-id upsert replaced the ring's content entirely: the fold
    // only ever exposes the latest tick, so the log must keep the old one.
    const second = advanceSubagentActivityLog(first, [
      agent({
        id: "a1",
        recentActivity: [{ at: "2026-08-01T10:00:05.000Z", summary: "▸ Bash" }],
      }),
    ]);
    expect(subagentLogEntries(second, "a1").map((entry) => entry.summary)).toEqual([
      "Reading files",
      "▸ Bash",
    ]);
  });

  it("ignores createdAt sliding on an unchanged upserted row", () => {
    const first = advanceSubagentActivityLog(emptySubagentActivityLog(), [
      agent({
        id: "a1",
        recentActivity: [{ at: "2026-08-01T10:00:01.000Z", summary: "Scanning" }],
      }),
    ]);
    const second = advanceSubagentActivityLog(first, [
      agent({
        id: "a1",
        recentActivity: [{ at: "2026-08-01T10:00:09.000Z", summary: "Scanning" }],
      }),
    ]);
    expect(subagentLogEntries(second, "a1").map((entry) => entry.summary)).toEqual(["Scanning"]);
  });

  it("records a genuine A → B → A repeat", () => {
    let log = advanceSubagentActivityLog(emptySubagentActivityLog(), [
      agent({ id: "a1", recentActivity: [{ at: "2026-08-01T10:00:01.000Z", summary: "▸ Read" }] }),
    ]);
    log = advanceSubagentActivityLog(log, [
      agent({ id: "a1", recentActivity: [{ at: "2026-08-01T10:00:02.000Z", summary: "▸ Bash" }] }),
    ]);
    log = advanceSubagentActivityLog(log, [
      agent({ id: "a1", recentActivity: [{ at: "2026-08-01T10:00:03.000Z", summary: "▸ Read" }] }),
    ]);
    expect(subagentLogEntries(log, "a1").map((entry) => entry.summary)).toEqual([
      "▸ Read",
      "▸ Bash",
      "▸ Read",
    ]);
  });

  it("returns the same log reference when nothing changed", () => {
    const roster = [
      agent({
        id: "a1",
        recentActivity: [{ at: "2026-08-01T10:00:01.000Z", summary: "Working on it" }],
      }),
    ];
    const first = advanceSubagentActivityLog(emptySubagentActivityLog(), roster);
    const second = advanceSubagentActivityLog(first, roster);
    expect(second).toBe(first);
  });

  it("appends terminal status and result lines once", () => {
    const running = advanceSubagentActivityLog(emptySubagentActivityLog(), [agent({ id: "a1" })]);
    const done = agent({
      id: "a1",
      status: "completed",
      result: "Found 3 issues",
      completedAt: "2026-08-01T10:02:30.000Z",
      updatedAt: "2026-08-01T10:02:30.000Z",
    });
    const settled = advanceSubagentActivityLog(running, [done]);
    const again = advanceSubagentActivityLog(settled, [done]);
    const entries = subagentLogEntries(again, "a1");
    expect(entries.map((entry) => [entry.kind, entry.summary])).toEqual([
      ["status", "Completed in 2m 30s"],
      ["result", "Found 3 issues"],
    ]);
  });

  it("marks a failed run with its error and duration", () => {
    const running = advanceSubagentActivityLog(emptySubagentActivityLog(), [agent({ id: "a1" })]);
    const failed = advanceSubagentActivityLog(running, [
      agent({
        id: "a1",
        status: "failed",
        error: "exploded",
        completedAt: "2026-08-01T10:00:45.000Z",
        updatedAt: "2026-08-01T10:00:45.000Z",
      }),
    ]);
    expect(subagentLogEntries(failed, "a1").map((entry) => [entry.kind, entry.summary])).toEqual([
      ["status", "Failed after 45s"],
      ["error", "exploded"],
    ]);
  });

  it("notes reactivation of a settled identity", () => {
    let log = advanceSubagentActivityLog(emptySubagentActivityLog(), [
      agent({ id: "a1", status: "idle" }),
    ]);
    log = advanceSubagentActivityLog(log, [
      agent({ id: "a1", status: "running", activationCount: 2 }),
    ]);
    const summaries = subagentLogEntries(log, "a1").map((entry) => entry.summary);
    expect(summaries).toContain("Reactivated · run 2");
  });

  it("keeps history for agents that drop out of the roster", () => {
    const first = advanceSubagentActivityLog(emptySubagentActivityLog(), [
      agent({
        id: "a1",
        recentActivity: [{ at: "2026-08-01T10:00:01.000Z", summary: "Old work" }],
      }),
    ]);
    const second = advanceSubagentActivityLog(first, [agent({ id: "a2" })]);
    expect(subagentLogEntries(second, "a1").map((entry) => entry.summary)).toEqual(["Old work"]);
  });
});
