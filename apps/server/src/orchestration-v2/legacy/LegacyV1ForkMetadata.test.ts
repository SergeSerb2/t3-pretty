import { describe, expect, it } from "vite-plus/test";
import { classifyTaskAgentKind, OrchestrationV2DomainEvent } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { transferProjection } from "../../project/ProjectTransfer.testkit.ts";
import {
  foldSubagentActivities,
  legacyV1ForkMetadata,
  type LegacyForkActivity,
} from "./LegacyV1ForkMetadata.ts";
let sequence = 0;
/**
 * Fixtures model POST-INGESTION rows: ingestion stamps agentKind on every
 * task.* payload, so the helper stamps too (same classifier). Pass an
 * explicit agentKind (or agentKind: undefined via legacy()) to override.
 */
function activity(
  kind: string,
  payload: Record<string, unknown>,
  at = DateTime.formatIso(
    DateTime.add(DateTime.makeUnsafe("2026-08-01T10:00:00.000Z"), { seconds: sequence }),
  ),
): LegacyForkActivity {
  sequence += 1;
  const stamped =
    kind.startsWith("task.") && !("agentKind" in payload)
      ? {
          ...payload,
          agentKind: classifyTaskAgentKind({
            taskType: typeof payload.taskType === "string" ? payload.taskType : undefined,
            agentId: typeof payload.agentId === "string" ? payload.agentId : undefined,
          }),
        }
      : payload;
  return {
    id: `activity-${sequence}`,
    kind,
    summary: kind,
    payload: stamped,
    ordinal: sequence,
    createdAt: at,
  };
}

/** A pre-stamp row (legacy thread / old server): no agentKind at all. */
function legacyActivity(kind: string, payload: Record<string, unknown>): LegacyForkActivity {
  sequence += 1;
  return {
    id: `activity-${sequence}`,
    kind,
    summary: kind,
    payload,
    ordinal: sequence,
    createdAt: DateTime.formatIso(
      DateTime.add(DateTime.makeUnsafe("2026-08-01T10:00:00.000Z"), { seconds: sequence }),
    ),
  };
}

function fold(rows: ReadonlyArray<LegacyForkActivity>) {
  return foldSubagentActivities(rows);
}

describe("foldSubagentActivities", () => {
  it("shows the batch status limit after its parent turn ends without claiming a result", () => {
    const running = activity("task.progress", {
      taskId: "batch-1",
      taskType: "subagent_batch",
      title: "Antigravity subagent batch",
      status: "running",
      summary: "Launch readers",
    });
    const agents = fold([
      running,
      activity("task.updated", {
        taskId: "batch-1",
        taskType: "subagent_batch",
        status: "idle",
        detail: "Turn ended. Individual agent status is unavailable.",
        timelineBypass: true,
      }),
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      title: "Antigravity subagent batch",
      kind: "subagent_batch",
      status: "idle",
      progress: "Turn ended. Individual agent status is unavailable.",
      result: null,
      error: null,
    });
  });

  it("learns batch identity from a later update and retains it on sparse updates", () => {
    const agents = fold([
      activity("task.progress", { taskId: "batch-1", taskType: "subagent", status: "running" }),
      activity("task.updated", { taskId: "batch-1", taskType: "subagent_batch", status: "idle" }),
      activity("task.updated", { taskId: "batch-1", status: "idle" }),
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ kind: "subagent_batch", status: "idle" });
  });

  it("builds an agent from start → progress → completion", () => {
    const agents = fold([
      activity("task.started", {
        taskId: "task-1",
        title: "Audit auth flow",
        role: "explorer",
      }),
      activity("task.progress", {
        taskId: "task-1",
        lastToolName: "Read",
        typedUsage: { totalTokens: 1200, toolUses: 3 },
      }),
      activity("task.completed", {
        taskId: "task-1",
        status: "completed",
        summary: "Found 2 issues",
        typedUsage: { totalTokens: 5000, toolUses: 9 },
      }),
    ]);
    expect(agents).toHaveLength(1);
    const agent = agents[0]!;
    expect(agent.title).toBe("Audit auth flow");
    expect(agent.role).toBe("explorer");
    expect(agent.status).toBe("completed");
    expect(agent.result).toBe("Found 2 issues");
    expect(agent.usage?.totalTokens).toBe(5000);
    expect(agent.activationCount).toBe(1);
    expect(agent.completedAt).not.toBeNull();
  });

  it("progress can create an agent when its start row aged out of retention", () => {
    const agents = fold([
      activity("task.progress", {
        taskId: "task-orphan",
        title: "Recovered agent",
        role: "verifier",
        typedUsage: { totalTokens: 100 },
      }),
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.title).toBe("Recovered agent");
    expect(agents[0]!.status).toBe("running");
  });

  it("uses legacy detail progress before falling back to a generic tool name", () => {
    const agents = fold([
      activity("task.started", {
        taskId: "task-detail",
        title: "Map T3 Connect system",
      }),
      activity("task.progress", {
        taskId: "task-detail",
        detail: "Running Compare tunnel limit on main",
        lastToolName: "Bash",
      }),
    ]);

    expect(agents[0]?.progress).toBe("Running Compare tunnel limit on main");
    expect(agents[0]?.recentActivity.map((entry) => entry.summary)).toEqual([
      "Running Compare tunnel limit on main",
    ]);
  });

  it("does not mistake a task description in detail for live progress", () => {
    const agents = fold([
      activity("task.progress", {
        taskId: "task-description",
        title: "Map T3 Connect system",
        detail: "Map T3 Connect system",
        lastToolName: "Bash",
      }),
    ]);

    expect(agents[0]?.progress).toBeNull();
    expect(agents[0]?.recentActivity.map((entry) => entry.summary)).toEqual(["▸ Bash"]);
  });

  it("completion before start stays terminal; a late start only fills metadata", () => {
    const agents = fold([
      activity("task.completed", {
        taskId: "task-2",
        status: "failed",
        summary: "boom",
        role: "fixer",
      }),
      activity("task.started", { taskId: "task-2", title: "Late metadata", role: "fixer" }),
    ]);
    expect(agents).toHaveLength(1);
    const agent = agents[0]!;
    expect(agent.title).toBe("Late metadata");
    expect(agent.role).toBe("fixer");
    // The late start must NOT reopen the terminal activation as a new run.
    expect(agent.status).toBe("failed");
    expect(agent.error).toBe("boom");
  });

  it("duplicate terminal events are idempotent (timestamps do not slide)", () => {
    const agents = fold([
      activity("task.started", { taskId: "task-3", taskType: "local_agent" }),
      activity(
        "task.completed",
        { taskId: "task-3", status: "completed" },
        "2026-08-01T11:00:00.000Z",
      ),
      activity(
        "task.completed",
        { taskId: "task-3", status: "completed" },
        "2026-08-01T12:00:00.000Z",
      ),
    ]);
    expect(agents[0]!.completedAt).toBe("2026-08-01T11:00:00.000Z");
  });

  it("reactivation increments the run count and clears result/error", () => {
    const agents = fold([
      activity("task.started", { taskId: "task-4", taskType: "local_agent" }),
      activity("task.completed", { taskId: "task-4", status: "completed", summary: "run 1 done" }),
      activity("task.updated", { taskId: "task-4", status: "running" }),
    ]);
    const agent = agents[0]!;
    expect(agent.activationCount).toBe(2);
    expect(agent.result).toBeNull();
    expect(agent.completedAt).toBeNull();
    expect(agent.status).toBe("running");
  });

  it("idle is nonterminal: an idle agent resumes without losing identity", () => {
    const agents = fold([
      activity("task.started", { taskId: "codex-child-1", title: "Marlow", role: "explorer" }),
      activity("task.updated", { taskId: "codex-child-1", status: "idle" }),
      activity("task.updated", { taskId: "codex-child-1", status: "running" }),
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.activationCount).toBe(2);
    expect(agents[0]!.status).toBe("running");
  });

  it("cumulative usage max-merges: duplicate and late frames never shrink or double-count", () => {
    const agents = fold([
      activity("task.started", { taskId: "task-5", taskType: "local_agent" }),
      activity("task.progress", {
        taskId: "task-5",
        typedUsage: { totalTokens: 900, inputTokens: 700 },
      }),
      activity("task.progress", {
        taskId: "task-5",
        typedUsage: { totalTokens: 900, inputTokens: 700 },
      }),
      activity("task.progress", { taskId: "task-5", typedUsage: { totalTokens: 500 } }),
    ]);
    expect(agents[0]!.usage).toEqual({ totalTokens: 900, inputTokens: 700 });
  });

  it("usage snapshots enrich an existing agent without changing its status", () => {
    const [agent] = fold([
      activity("task.started", { taskId: "usage-waiting", taskType: "local_agent" }),
      activity("task.progress", { taskId: "usage-waiting", status: "waiting" }),
      activity("task.progress", {
        taskId: "usage-waiting",
        usageSnapshot: true,
        typedUsage: { totalTokens: 1_200 },
      }),
    ]);

    expect(agent?.status).toBe("waiting");
    expect(agent?.usage?.totalTokens).toBe(1_200);
  });

  it("a retained usage snapshot can still reconstruct a running agent", () => {
    const [agent] = fold([
      activity("task.progress", {
        taskId: "usage-only",
        usageSnapshot: true,
        typedUsage: { totalTokens: 800 },
      }),
    ]);

    expect(agent?.status).toBe("running");
    expect(agent?.usage?.totalTokens).toBe(800);
  });

  it("partial terminal usage preserves known breakdown fields", () => {
    const agents = fold([
      activity("task.started", { taskId: "task-6", taskType: "local_agent" }),
      activity("task.progress", {
        taskId: "task-6",
        typedUsage: { totalTokens: 800, inputTokens: 600, outputTokens: 150 },
      }),
      activity("task.completed", {
        taskId: "task-6",
        status: "completed",
        typedUsage: { totalTokens: 1000 },
      }),
    ]);
    expect(agents[0]!.usage).toEqual({ totalTokens: 1000, inputTokens: 600, outputTokens: 150 });
  });

  it("skips malformed rows individually without failing the fold", () => {
    const agents = fold([
      activity("task.started", { taskId: "task-7", title: "Good", taskType: "local_agent" }),
      activity("task.progress", { bogus: true }),
      activity("task.progress", { taskId: 42 }),
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.title).toBe("Good");
  });

  it("bounds repeated strings at 180 chars and the activity ring at 6 deduped entries", () => {
    const long = "x".repeat(500);
    const rows = [activity("task.started", { taskId: "task-8", taskType: "local_agent" })];
    for (let i = 0; i < 10; i += 1) {
      rows.push(activity("task.progress", { taskId: "task-8", summary: `${long}-${i}` }));
    }
    rows.push(activity("task.progress", { taskId: "task-8", summary: `${long}-9` }));
    const agents = fold(rows);
    const agent = agents[0]!;
    expect(agent.recentActivity.length).toBeLessThanOrEqual(6);
    for (const entry of agent.recentActivity) {
      expect(entry.summary.length).toBeLessThanOrEqual(180);
    }
    // Consecutive identical summaries dedupe (truncation makes them equal).
    const summaries = agent.recentActivity.map((entry) => entry.summary);
    expect(new Set(summaries).size).toBe(summaries.length);
  });

  it("plan tasks are not agents", () => {
    const agents = fold([activity("task.started", { taskId: "plan-1", taskType: "plan" })]);
    expect(agents).toHaveLength(0);
  });

  it("workflow members key by stable slot and attach to their coordinator", () => {
    const agents = fold([
      activity("task.started", {
        taskId: "wf-1",
        taskType: "local_workflow",
        title: "audit-auth-flow",
        workflowName: "audit-auth-flow",
      }),
      activity("task.progress", {
        taskId: "wf-1",
        phases: [
          { index: 0, title: "Audit" },
          { index: 1, title: "Verify" },
        ],
      }),
      activity("task.progress", {
        taskId: "wf-1:wf:0",
        title: "audit:entrypoints",
        status: "running",
        parentAgentId: "wf-1",
        agentIndex: 0,
        phaseIndex: 0,
        phaseTitle: "Audit",
        timelineBypass: true,
      }),
    ]);
    const workflow = agents.find((agent) => agent.id === "wf-1");
    const member = agents.find((agent) => agent.id === "wf-1:wf:0");
    expect(workflow?.kind).toBe("workflow");
    expect(workflow?.phases).toEqual([
      { index: 0, title: "Audit" },
      { index: 1, title: "Verify" },
    ]);
    expect(member?.kind).toBe("workflow_agent");
    expect(member?.parentAgentId).toBe("wf-1");
  });

  it("a workflow member retry (attempt bump) is a reactivation of the same slot", () => {
    const agents = fold([
      activity("task.progress", {
        taskId: "wf-2:wf:1",
        title: "verify:refresh",
        status: "failed",
        error: "attempt 1 died",
        parentAgentId: "wf-2",
        attempt: 1,
      }),
      activity("task.progress", {
        taskId: "wf-2:wf:1",
        title: "verify:refresh",
        status: "running",
        parentAgentId: "wf-2",
        attempt: 2,
      }),
    ]);
    expect(agents).toHaveLength(1);
    const member = agents[0]!;
    expect(member.activationCount).toBeGreaterThanOrEqual(2);
    expect(member.error).toBeNull();
    expect(member.status).toBe("running");
  });

  it("drops non-http(s) session urls at the fold boundary", () => {
    const agents = fold([
      activity("task.started", {
        taskId: "wf-3",
        taskType: "local_workflow",
        runHandles: { sessionUrl: "javascript:alert(1)", runId: "run-1" },
      }),
    ]);
    expect(agents[0]!.runHandles?.sessionUrl).toBeUndefined();
    expect(agents[0]!.runHandles?.runId).toBe("run-1");
  });
});

describe("background task exclusion", () => {
  it("shells and monitors never join the roster (from any lifecycle row)", () => {
    const agents = fold([
      activity("task.started", { taskId: "shell-1", taskType: "shell", title: "Run 12s stall" }),
      activity("task.progress", { taskId: "shell-2", taskType: "shell", title: "Run stall" }),
      activity("task.completed", { taskId: "mon-1", taskType: "monitor", status: "completed" }),
      activity("task.started", { taskId: "agent-1", taskType: "subagent", title: "Real agent" }),
    ]);
    expect(agents.map((agent) => agent.id)).toEqual(["agent-1"]);
  });

  it("rows without a taskType stay in the roster (workflow members, Codex children)", () => {
    const agents = fold([
      activity("task.progress", { taskId: "wf-1:wf:0", status: "running", parentAgentId: "wf-1" }),
    ]);
    expect(agents).toHaveLength(1);
  });

  it("the server stamp is the only classifier: no stamp means no roster row", () => {
    const agents = fold([
      // Stamped background: agent-looking fields don't matter.
      activity("task.started", {
        taskId: "bg-1",
        agentKind: "background",
        role: "watcher",
        model: "sonnet",
      }),
      // Stamped agent: plain row still joins the roster.
      activity("task.started", { taskId: "ag-1", agentKind: "agent", detail: "plain row" }),
      // Legacy pre-stamp rows (old threads/servers) stay in the work log —
      // exactly their pre-upgrade behavior.
      legacyActivity("task.started", { taskId: "old-task", detail: "tailing logs" }),
      legacyActivity("task.progress", { taskId: "old-task", summary: "still tailing" }),
    ]);
    expect(agents.map((agent) => agent.id)).toEqual(["ag-1"]);
  });

  it("membership is sticky: a stampless later row still reaches a known agent", () => {
    const agents = fold([
      activity("task.started", { taskId: "a1", taskType: "local_agent", title: "Agent" }),
      // Terminal row missing the stamp (defensive: adapters synthesize some
      // rows) — sticky membership still routes it to the agent.
      legacyActivity("task.completed", { taskId: "a1", status: "completed", summary: "done" }),
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.status).toBe("completed");
    expect(agents[0]!.result).toBe("done");
  });
});

describe("session-derived interruption", () => {
  it("dead session interrupts live agents but preserves idle and settled", () => {
    const rows = [
      activity("task.started", { taskId: "live-1", taskType: "local_agent" }),
      activity("task.started", { taskId: "idle-1", taskType: "local_agent" }),
      activity("task.updated", { taskId: "idle-1", status: "idle" }),
      activity("task.started", { taskId: "done-1", taskType: "local_agent" }),
      activity("task.completed", { taskId: "done-1", status: "completed" }),
    ];
    const dead = foldSubagentActivities(rows, { sessionLive: false });
    expect(dead.find((agent) => agent.id === "live-1")?.status).toBe("interrupted");
    expect(dead.find((agent) => agent.id === "idle-1")?.status).toBe("idle");
    expect(dead.find((agent) => agent.id === "done-1")?.status).toBe("completed");
    const alive = foldSubagentActivities(rows, { sessionLive: true });
    expect(alive.find((agent) => agent.id === "live-1")?.status).toBe("running");
  });
});

describe("terminal robustness", () => {
  it("task.updated creating an agent (start row aged out) counts one activation", () => {
    const agents = fold([
      activity("task.updated", { taskId: "orphan-u", status: "running", role: "worker" }),
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.activationCount).toBe(1);
    expect(agents[0]!.status).toBe("running");
  });

  it("a late start after a terminal task.updated does not reopen the run", () => {
    const agents = fold([
      activity("task.updated", { taskId: "t1", status: "failed", role: "worker" }),
      activity("task.started", { taskId: "t1", taskType: "local_agent", title: "Late" }),
    ]);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.status).toBe("failed");
    expect(agents[0]!.title).toBe("Late");
  });

  it("a completion after a terminal task.updated still enriches result and usage", () => {
    // Claude commonly emits terminal task.updated before task.completed;
    // the completion carries the summary and final usage the update lacked.
    const agents = fold([
      activity("task.started", { taskId: "te-1", taskType: "local_agent" }),
      activity(
        "task.updated",
        { taskId: "te-1", status: "completed", endedAt: "2026-08-01T10:59:00.000Z" },
        "2026-08-01T11:00:00.000Z",
      ),
      activity(
        "task.completed",
        {
          taskId: "te-1",
          status: "completed",
          summary: "final answer",
          typedUsage: { totalTokens: 4200, toolUses: 7 },
        },
        "2026-08-01T11:00:01.000Z",
      ),
    ]);
    const agent = agents[0]!;
    expect(agent.status).toBe("completed");
    expect(agent.result).toBe("final answer");
    expect(agent.usage?.totalTokens).toBe(4200);
    // Timestamps stay pinned to the transition that settled the run.
    expect(agent.completedAt).toBe("2026-08-01T10:59:00.000Z");
  });

  it("duplicate completions keep the FIRST result, not the last", () => {
    const agents = fold([
      activity("task.started", { taskId: "t2", taskType: "local_agent" }),
      activity("task.completed", { taskId: "t2", status: "completed", summary: "first result" }),
      activity("task.completed", { taskId: "t2", status: "completed", summary: "second result" }),
    ]);
    expect(agents[0]!.result).toBe("first result");
  });

  it("provider endedAt wins over ingestion time on the settling transition", () => {
    const agents = fold([
      activity("task.started", { taskId: "t3", taskType: "local_agent" }),
      activity(
        "task.updated",
        { taskId: "t3", status: "failed", endedAt: "2026-08-01T09:59:59.000Z" },
        "2026-08-01T10:00:30.000Z",
      ),
    ]);
    expect(agents[0]!.completedAt).toBe("2026-08-01T09:59:59.000Z");
  });

  it("workflow retries count each attempt once", () => {
    const agents = fold([
      activity("task.progress", {
        taskId: "wf-r:wf:0",
        parentAgentId: "wf-r",
        status: "running",
        attempt: 1,
      }),
      activity("task.progress", {
        taskId: "wf-r:wf:0",
        parentAgentId: "wf-r",
        status: "failed",
        attempt: 1,
      }),
      activity("task.progress", {
        taskId: "wf-r:wf:0",
        parentAgentId: "wf-r",
        status: "running",
        attempt: 2,
      }),
    ]);
    expect(agents[0]!.activationCount).toBe(2);
  });
});

describe("coordinator settle cascade", () => {
  it("members without their own terminal row settle when the coordinator does", () => {
    const agents = fold([
      activity("task.started", { taskId: "wf-1", taskType: "local_workflow" }),
      activity("task.progress", {
        taskId: "wf-1:wf:0",
        title: "stalled member",
        status: "running",
        parentAgentId: "wf-1",
      }),
      activity("task.completed", {
        taskId: "wf-1",
        status: "completed",
        taskType: "local_workflow",
      }),
    ]);
    const member = agents.find((agent) => agent.id === "wf-1:wf:0");
    expect(member?.status).toBe("completed");
    expect(member?.completedAt).not.toBeNull();
  });

  it("a failed coordinator marks unfinished members interrupted, not completed", () => {
    const agents = fold([
      activity("task.started", { taskId: "wf-2", taskType: "local_workflow" }),
      activity("task.progress", {
        taskId: "wf-2:wf:0",
        status: "running",
        parentAgentId: "wf-2",
      }),
      activity("task.completed", { taskId: "wf-2", status: "failed", taskType: "local_workflow" }),
    ]);
    const member = agents.find((agent) => agent.id === "wf-2:wf:0");
    expect(member?.status).toBe("interrupted");
  });

  it("settles a large indexed workflow roster before applying the 100-agent cap", () => {
    const rows: LegacyForkActivity[] = [];
    const workflowCount = 120;

    for (let index = 0; index < workflowCount; index += 1) {
      const workflowId = `large-wf-${index}`;
      const at = (offset: number) => {
        const seconds = index * 3 + offset;
        const minute = String(Math.floor(seconds / 60)).padStart(2, "0");
        const second = String(seconds % 60).padStart(2, "0");
        return `2026-08-01T10:${minute}:${second}.000Z`;
      };
      rows.push(
        activity("task.started", { taskId: workflowId, taskType: "local_workflow" }, at(0)),
        activity(
          "task.progress",
          {
            taskId: `${workflowId}:wf:0`,
            parentAgentId: workflowId,
            status: "running",
          },
          at(1),
        ),
        activity(
          "task.completed",
          { taskId: workflowId, taskType: "local_workflow", status: "completed" },
          at(2),
        ),
      );
    }

    const agents = fold(rows);
    expect(agents).toHaveLength(100);
    expect(agents.every((agent) => agent.status === "completed")).toBe(true);
    expect(agents.slice(0, 2).map((agent) => agent.id)).toEqual([
      "large-wf-119",
      "large-wf-119:wf:0",
    ]);
    expect(agents.slice(-2).map((agent) => agent.id)).toEqual(["large-wf-70", "large-wf-70:wf:0"]);
  });
});

describe("task type classification is a denylist", () => {
  it("unknown agent-flavored types (local_agent, future names) join the roster", () => {
    const agents = fold([
      activity("task.started", {
        taskId: "a1",
        taskType: "local_agent",
        title: "Math test 1",
        role: "claude",
      }),
      activity("task.started", { taskId: "a2", taskType: "some_future_agent_kind", title: "X" }),
    ]);
    expect(agents.map((agent) => agent.id).toSorted()).toEqual(["a1", "a2"]);
  });
});

describe("nested agents vs subagent shells", () => {
  it("a nested agent (agentId + agent taskType) stays in the roster; its shells do not", () => {
    const agents = fold([
      activity("task.started", {
        taskId: "nested-1",
        taskType: "local_agent",
        agentId: "parent-agent",
        title: "Nested researcher",
      }),
      activity("task.started", {
        taskId: "shell-1",
        taskType: "local_bash",
        agentId: "parent-agent",
        title: "Nested sleep",
      }),
    ]);
    expect(agents.map((agent) => agent.id)).toEqual(["nested-1"]);
  });
});

describe("V1 fork history mapping", () => {
  it("preserves workflow relationships, retries, usage and provenance as V2 records", () => {
    const thread = transferProjection().thread;
    const rows = [
      activity("task.started", {
        taskId: "workflow",
        taskType: "local_workflow",
        workflowName: "Review",
        phases: [{ index: 0, title: "Verify" }],
        runHandles: { scriptPath: "/repo/review.sh", sessionUrl: "https://example.test/session" },
      }),
      activity("task.started", {
        taskId: "reviewer",
        parentAgentId: "workflow",
        role: "reviewer",
        model: "gpt-5.6",
        effort: "high",
        phaseIndex: 0,
        agentIndex: 1,
        attempt: 1,
        phaseTitle: "Verify",
      }),
      activity("task.completed", {
        taskId: "reviewer",
        parentAgentId: "workflow",
        status: "failed",
        typedUsage: { totalTokens: 100, outputTokens: 40 },
        detail: "First attempt failed",
      }),
      activity("task.progress", {
        taskId: "reviewer",
        parentAgentId: "workflow",
        status: "running",
        attempt: 2,
        typedUsage: { totalTokens: 200 },
        lastToolName: "Read",
        outputFile: "/repo/review.txt",
        summary: "Checking again",
      }),
      activity("task.completed", {
        taskId: "workflow",
        taskType: "local_workflow",
        status: "completed",
      }),
    ];
    const metadata = legacyV1ForkMetadata(thread, rows);
    const agents = metadata.events.flatMap((event) =>
      event.type === "subagent.updated" ? [event.payload] : [],
    );
    expect(agents).toHaveLength(2);
    expect(agents[0]).toMatchObject({
      kind: "workflow",
      workflowName: "Review",
      phases: [{ index: 0, title: "Verify" }],
      runHandles: { scriptPath: "/repo/review.sh" },
    });
    expect(agents[1]).toMatchObject({
      kind: "workflow_agent",
      parentAgentId: agents[0]!.id,
      parentNodeId: agents[0]!.id,
      role: "reviewer",
      effort: "high",
      activationCount: 2,
      attempt: 2,
      phaseIndex: 0,
      status: "completed",
      usage: { totalTokens: 200, outputTokens: 40 },
      lastToolName: "Read",
      outputFile: "/repo/review.txt",
      nativeTaskRef: null,
      providerThreadId: null,
    });
    expect(agents[1]!.recentActivity?.length).toBeGreaterThan(0);
    for (const event of metadata.events)
      expect(() => Schema.encodeSync(OrchestrationV2DomainEvent)(event)).not.toThrow();
    expect(legacyV1ForkMetadata(thread, rows).events.map((event) => event.id)).toEqual(
      metadata.events.map((event) => event.id),
    );
  });

  it("coalesces image lifecycle rows and retains native encoded session paths verbatim", () => {
    const thread = transferProjection().thread;
    const path = "/repo/Grok/foo%2Fbar/images/1.jpg";
    const rows = [
      activity(
        "tool.started",
        {
          itemType: "image_generation",
          toolCallId: "image-call",
          title: "Imagine",
          data: { prompt: "A comet" },
        },
        "2026-08-01T10:00:01.000Z",
      ),
      activity(
        "tool.completed",
        {
          itemType: "image_generation",
          toolCallId: "image-call",
          title: "Imagine",
          data: { rawOutput: { savedPath: path } },
        },
        "2026-08-01T10:00:03.000Z",
      ),
      activity("tool.completed", {
        itemType: "image_view",
        toolCallId: "image-view",
        data: { path: "/repo/source.jpg" },
      }),
    ];
    const metadata = legacyV1ForkMetadata(thread, rows);
    const images = metadata.events.flatMap((event) =>
      event.type === "turn-item.updated" && event.payload.type === "image_generation"
        ? [event.payload]
        : [],
    );
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      savedPath: path,
      paths: [path],
      prompt: "A comet",
      status: "completed",
    });
    expect(metadata.imagePositions).toEqual([
      { id: images[0]!.id, at: "2026-08-01T10:00:01.000Z" },
    ]);
    expect(() =>
      Schema.encodeSync(OrchestrationV2DomainEvent)(
        metadata.events.find((event) => event.type === "turn-item.updated")!,
      ),
    ).not.toThrow();
  });

  it("imports the latest headline and current plan without replacing newer V2 metadata", () => {
    const thread = transferProjection().thread;
    const rows = [
      { ...activity("turn.headline", {}), summary: "Checking the importer" },
      activity("turn.plan.updated", {
        plan: [
          { step: "Read", status: "completed" },
          { step: "Port", status: "inProgress" },
          { step: "Check", status: "pending" },
        ],
      }),
      activity("task.started", { taskId: "old-live", taskType: "subagent" }),
      activity("task.updated", { taskId: "idle-child", taskType: "subagent", status: "idle" }),
    ];
    const mapped = legacyV1ForkMetadata(thread, rows);
    expect(mapped.thread).toMatchObject({
      liveHeadline: "Checking the importer",
      planProgress: { step: "Port", completedSteps: 1, totalSteps: 3 },
    });
    const agents = mapped.events.flatMap((event) =>
      event.type === "subagent.updated" ? [event.payload] : [],
    );
    expect(agents.map((agent) => agent.status)).toEqual(["interrupted", "idle"]);
    const current = {
      ...thread,
      liveHeadline: "Current V2 headline",
      planProgress: { step: "Ship", completedSteps: 4, totalSteps: 5 },
    };
    expect(legacyV1ForkMetadata(current, rows).thread).toMatchObject(current);
  });
});

it("retains the latest per-turn checklist and historical step durations", () => {
  const thread = transferProjection().thread;
  const first = {
    ...activity(
      "turn.plan.updated",
      {
        plan: [
          { step: "Read", status: "inProgress" },
          { step: "Port", status: "pending" },
        ],
        explanation: "Preserve history",
      },
      "2026-08-01T10:00:00.000Z",
    ),
    turnId: "legacy-turn",
  };
  const last = {
    ...activity(
      "turn.plan.updated",
      {
        plan: [
          { step: "Read", status: "completed" },
          { step: "Port", status: "inProgress" },
        ],
        explanation: "Preserve history",
      },
      "2026-08-01T10:00:10.000Z",
    ),
    turnId: "legacy-turn",
  };
  const metadata = legacyV1ForkMetadata(thread, [first, last]);
  const items = metadata.events.flatMap((event) =>
    event.type === "turn-item.updated" && event.payload.type === "todo_list" ? [event.payload] : [],
  );
  expect(items).toHaveLength(1);
  expect(items[0]!.steps).toMatchObject([
    {
      text: "Read",
      status: "completed",
      durationAnchorAt: "2026-08-01T10:00:00.000Z",
      durationMs: 10_000,
    },
    { text: "Port", status: "running", durationAnchorAt: "2026-08-01T10:00:10.000Z" },
  ]);
  expect(items[0]!.explanation).toBe("Preserve history");
  expect(metadata.itemPositions).toEqual([{ id: items[0]!.id, at: "2026-08-01T10:00:00.000Z" }]);
  expect(metadata.events.filter((event) => event.type === "plan.updated")).toHaveLength(1);
  for (const event of metadata.events)
    expect(() => Schema.encodeSync(OrchestrationV2DomainEvent)(event)).not.toThrow();
});
