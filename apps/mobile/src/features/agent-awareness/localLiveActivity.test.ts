import { presentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, RunId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";
import { makeRawThreadShell } from "../../test-fixtures";
import { buildLocalLiveActivityProps, liveActivityContentFingerprint } from "./localLiveActivity";

const environmentId = EnvironmentId.make("env-1");
const NOW = "2026-06-02T00:00:00.000Z";
const nowMs = Date.parse(NOW);
const projects = [{ id: ProjectId.make("project-1"), environmentId, title: "t3-pretty" }];
function makeThread(input: Partial<OrchestrationV2ThreadShell> = {}) {
  return presentThreadShell(environmentId, makeRawThreadShell({
    id: ThreadId.make("thread-1"), projectId: projects[0]!.id,
    createdAt: DateTime.makeUnsafe(NOW), updatedAt: DateTime.makeUnsafe(NOW), ...input,
  }));
}
function props(input: Partial<OrchestrationV2ThreadShell>) {
  return buildLocalLiveActivityProps({ threads: [makeThread(input)], projects, nowMs });
}
describe("buildLocalLiveActivityProps", () => {
  it("does not arm a Done card for an idle thread without a completed run", () => {
    expect(props({ status: "idle" })).toBeNull();
    expect(props({ status: "completed", latestRunId: null })).toBeNull();
  });
  it("retains connected plan progress", () => {
    expect(props({ title: "Fix Live Activities", status: "running",
      planProgress: { step: "Editing AgentActivity.tsx", completedSteps: 2, totalSteps: 5 },
    })).toMatchObject({ title: "T3 Pretty", activeCount: 1,
      activities: [{ phase: "running", status: "Editing AgentActivity.tsx", progress: 0.4 }],
    });
  });
  it("uses the activity-owning run timer instead of a newer queued run", () => {
    expect(props({ status: "running",
      activityRunStartedAt: DateTime.makeUnsafe("2026-06-01T23:50:00.000Z"),
      latestRunStartedAt: DateTime.makeUnsafe("2026-06-01T23:59:00.000Z"),
    })?.activities[0]?.startedAt).toBe("2026-06-01T23:50:00.000Z");
  });
  it("uses the live headline before the plan step", () => {
    expect(props({ status: "running", liveHeadline: "Checking build output",
      planProgress: { step: "Compile", completedSteps: 1, totalSteps: 2 },
    })?.activities[0]?.status).toBe("Checking build output");
  });
  it("keeps recent completed work as Done", () => {
    expect(props({ status: "completed", latestRunId: RunId.make("run-1"),
      latestRunCompletedAt: DateTime.makeUnsafe(NOW),
    })).toMatchObject({ activeCount: 0, subtitle: "Agent work completed",
      activities: [{ phase: "completed", status: "Done" }],
    });
  });
  it("expires completed rows after fifteen minutes", () => {
    const old = DateTime.makeUnsafe("2026-06-01T23:40:00.000Z");
    expect(props({ status: "completed", latestRunId: RunId.make("run-1"),
      updatedAt: old, latestRunCompletedAt: old,
    })).toBeNull();
  });
  it("expires running rows after two hours", () => {
    expect(props({ status: "running", updatedAt: DateTime.makeUnsafe("2026-06-01T21:00:00.000Z") })).toBeNull();
  });
  it("does not surface provider-native subagent rows independently", () => {
    expect(props({ status: "running", lineage: { rootThreadId: ThreadId.make("parent"),
      parentThreadId: ThreadId.make("parent"), relationshipToParent: "subagent" },
    })).toBeNull();
  });
});

describe("liveActivityContentFingerprint", () => {
  it("ignores updatedAt so relative clocks can tick without a native rewrite", () => {
    const first = liveActivityContentFingerprint({
      title: "T3 Pretty",
      subtitle: "Agent work in progress",
      activeCount: 1,
      updatedAt: "2026-06-02T00:00:00.000Z",
      activities: [
        {
          environmentId: "env-1",
          threadId: "thread-1",
          projectTitle: "t3-pretty",
          threadTitle: "Fix Live Activities",
          modelTitle: "gpt-5.4",
          phase: "running",
          status: "Working",
          updatedAt: "2026-06-02T00:00:00.000Z",
          deepLink: "/threads/env-1/thread-1",
        },
      ],
    });
    const second = liveActivityContentFingerprint({
      title: "T3 Pretty",
      subtitle: "Agent work in progress",
      activeCount: 1,
      updatedAt: "2026-06-02T00:01:00.000Z",
      activities: [
        {
          environmentId: "env-1",
          threadId: "thread-1",
          projectTitle: "t3-pretty",
          threadTitle: "Fix Live Activities",
          modelTitle: "gpt-5.4",
          phase: "running",
          status: "Working",
          updatedAt: "2026-06-02T00:01:00.000Z",
          deepLink: "/threads/env-1/thread-1",
        },
      ],
    });
    expect(first).toBe(second);
  });
});
