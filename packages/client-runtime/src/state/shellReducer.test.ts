import { describe, expect, it } from "vite-plus/test";

import { AutomationId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { AutomationShell } from "@t3tools/contracts";
import type { OrchestrationShellSnapshot, OrchestrationShellStreamEvent } from "@t3tools/contracts";

import { applyShellStreamEvent } from "./shellReducer.ts";

const baseSnapshot: OrchestrationShellSnapshot = {
  snapshotSequence: 0,
  projects: [],
  threads: [],
  automations: [],
  updatedAt: "2026-04-01T00:00:00.000Z",
};

const stubProject = {
  id: ProjectId.make("project-1"),
  title: "Test Project",
  workspaceRoot: "/workspace/test",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
} as const;

const stubThread = {
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  title: "Test Thread",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  branch: null,
  worktreePath: null,
  enabledSkillIds: [],
  latestTurn: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  session: null,
} as const;

const stubAutomation: AutomationShell = {
  id: AutomationId.make("automation-1"),
  projectId: ProjectId.make("project-1"),
  name: "Nightly triage",
  prompt: "Triage the inbox",
  triggers: [],
  enabled: true,
  modelSelection: null,
  runtimeMode: "full-access",
  workspace: "checkout",
  createPullRequest: false,
  includeLastRunSummary: false,
  catchUpMissedRuns: true,
  minIntervalSeconds: 60,
  timeoutMinutes: 120,
  webhookToken: null,
  sourceThreadId: null,
  createdAt: "2026-04-01T00:00:00.000Z",
  updatedAt: "2026-04-01T00:00:00.000Z",
  nextRunAt: null,
  activeRun: null,
  lastRun: null,
  lastRequestedAt: null,
  pendingTrigger: null,
  consecutiveFailures: 0,
  runCount: 0,
  webhookPath: null,
};

describe("applyShellStreamEvent", () => {
  it("ignores stale project upserts without mutating the snapshot", () => {
    const snapshotWithProject: OrchestrationShellSnapshot = {
      ...baseSnapshot,
      snapshotSequence: 4,
      projects: [stubProject],
    };

    for (const sequence of [3, 4]) {
      const next = applyShellStreamEvent(snapshotWithProject, {
        kind: "project-upserted",
        sequence,
        project: { ...stubProject, title: "Stale Title" },
      });

      expect(next).toBe(snapshotWithProject);
      expect(next.snapshotSequence).toBe(4);
      expect(next.projects[0]?.title).toBe("Test Project");
    }
  });

  describe("project-upserted", () => {
    it("adds a new project", () => {
      const event: OrchestrationShellStreamEvent = {
        kind: "project-upserted",
        sequence: 1,
        project: stubProject,
      };

      const next = applyShellStreamEvent(baseSnapshot, event);

      expect(next.projects).toHaveLength(1);
      expect(next.projects[0]?.id).toBe("project-1");
      expect(next.snapshotSequence).toBe(1);
    });

    it("updates an existing project", () => {
      const snapshotWithProject: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        projects: [stubProject],
      };

      const updatedProject = { ...stubProject, title: "Updated Title" };
      const event: OrchestrationShellStreamEvent = {
        kind: "project-upserted",
        sequence: 2,
        project: updatedProject,
      };

      const next = applyShellStreamEvent(snapshotWithProject, event);

      expect(next.projects).toHaveLength(1);
      expect(next.projects[0]?.title).toBe("Updated Title");
      expect(next.snapshotSequence).toBe(2);
    });
  });

  describe("project-removed", () => {
    it("removes a project by id", () => {
      const snapshotWithProject: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        projects: [stubProject],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "project-removed",
        sequence: 3,
        projectId: ProjectId.make("project-1"),
      };

      const next = applyShellStreamEvent(snapshotWithProject, event);

      expect(next.projects).toHaveLength(0);
      expect(next.snapshotSequence).toBe(3);
    });
  });

  describe("thread-upserted", () => {
    it("adds a new thread", () => {
      const event: OrchestrationShellStreamEvent = {
        kind: "thread-upserted",
        sequence: 4,
        thread: stubThread,
      };

      const next = applyShellStreamEvent(baseSnapshot, event);

      expect(next.threads).toHaveLength(1);
      expect(next.threads[0]?.id).toBe("thread-1");
      expect(next.snapshotSequence).toBe(4);
    });

    it("updates an existing thread", () => {
      const snapshotWithThread: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread],
      };

      const updatedThread = { ...stubThread, title: "Updated Thread" };
      const event: OrchestrationShellStreamEvent = {
        kind: "thread-upserted",
        sequence: 5,
        thread: updatedThread,
      };

      const next = applyShellStreamEvent(snapshotWithThread, event);

      expect(next.threads).toHaveLength(1);
      expect(next.threads[0]?.title).toBe("Updated Thread");
    });

    it("reads each retained thread id only once while replacing a late entry", () => {
      let idReads = 0;
      const threads = Array.from({ length: 200 }, (_, index) => ({
        ...stubThread,
        get id() {
          idReads += 1;
          return ThreadId.make(`thread-${index}`);
        },
      }));
      const replacement = {
        ...stubThread,
        id: ThreadId.make("thread-199"),
        title: "Replacement",
      };

      const next = applyShellStreamEvent(
        { ...baseSnapshot, threads },
        { kind: "thread-upserted", sequence: 6, thread: replacement },
      );

      expect(idReads).toBe(threads.length);
      expect(next.threads.at(-1)).toBe(replacement);
    });
  });

  describe("thread-removed", () => {
    it("removes a thread by id", () => {
      const snapshotWithThread: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread],
      };

      const event: OrchestrationShellStreamEvent = {
        kind: "thread-removed",
        sequence: 6,
        threadId: ThreadId.make("thread-1"),
      };

      const next = applyShellStreamEvent(snapshotWithThread, event);

      expect(next.threads).toHaveLength(0);
      expect(next.snapshotSequence).toBe(6);
    });
  });

  describe("thread-touched", () => {
    it("bumps updatedAt on the known row and keeps sibling identities", () => {
      const other = { ...stubThread, id: ThreadId.make("thread-2") };
      const snapshotWithThreads: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread, other],
      };

      const next = applyShellStreamEvent(snapshotWithThreads, {
        kind: "thread-touched",
        sequence: 7,
        threadId: ThreadId.make("thread-1"),
        updatedAt: "2026-04-02T00:00:00.000Z",
      });

      expect(next.threads[0]?.updatedAt).toBe("2026-04-02T00:00:00.000Z");
      expect(next.threads[0]?.title).toBe("Test Thread");
      expect(next.threads[1]).toBe(other);
      expect(next.snapshotSequence).toBe(7);
    });

    it("advances the cursor without adding an unknown thread", () => {
      const next = applyShellStreamEvent(baseSnapshot, {
        kind: "thread-touched",
        sequence: 8,
        threadId: ThreadId.make("thread-missing"),
        updatedAt: "2026-04-02T00:00:00.000Z",
      });

      expect(next.threads).toHaveLength(0);
      expect(next.snapshotSequence).toBe(8);
    });
  });

  describe("automations", () => {
    it("adds, replaces, and removes rows", () => {
      const added = applyShellStreamEvent(baseSnapshot, {
        kind: "automation-upserted",
        sequence: 1,
        automation: stubAutomation,
      });
      expect(added.automations).toEqual([stubAutomation]);

      const renamed = applyShellStreamEvent(added, {
        kind: "automation-upserted",
        sequence: 2,
        automation: { ...stubAutomation, name: "Renamed" },
      });
      expect(renamed.automations).toHaveLength(1);
      expect(renamed.automations[0]?.name).toBe("Renamed");

      const removed = applyShellStreamEvent(renamed, {
        kind: "automation-removed",
        sequence: 3,
        automationId: stubAutomation.id,
      });
      expect(removed.automations).toHaveLength(0);
      expect(removed.snapshotSequence).toBe(3);
    });

    it("keeps the automation list identical across thread events", () => {
      const snapshot: OrchestrationShellSnapshot = {
        ...baseSnapshot,
        threads: [stubThread],
        automations: [stubAutomation],
      };

      const touched = applyShellStreamEvent(snapshot, {
        kind: "thread-touched",
        sequence: 9,
        threadId: stubThread.id,
        updatedAt: "2026-04-02T00:00:00.000Z",
      });
      const upserted = applyShellStreamEvent(touched, {
        kind: "thread-upserted",
        sequence: 10,
        thread: { ...stubThread, title: "Renamed thread" },
      });

      expect(touched.automations).toBe(snapshot.automations);
      expect(upserted.automations).toBe(snapshot.automations);
    });
  });

  it("returns original snapshot for unrecognized event kinds", () => {
    const unknownEvent = { kind: "unknown-future-event", sequence: 99 } as any;
    const next = applyShellStreamEvent(baseSnapshot, unknownEvent);
    expect(next).toBe(baseSnapshot);
  });
});
