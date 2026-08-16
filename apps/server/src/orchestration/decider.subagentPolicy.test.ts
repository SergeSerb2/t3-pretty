import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";

function makeReadModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    projects: [
      {
        id: ProjectId.make("project-1"),
        title: "Project",
        workspaceRoot: "/tmp/project-1",
        defaultModelSelection: null,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: ThreadId.make("thread-1"),
        projectId: ProjectId.make("project-1"),
        title: "Thread",
        modelSelection: { instanceId: ProviderInstanceId.make("grok"), model: "grok-4.6" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        scenery: null,
        enabledSkillIds: [],
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: NOW,
  };
}

it.layer(NodeServices.layer)("subagent policy decider", (it) => {
  it.effect("thread.create carries a pinned policy into thread.created", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.make("cmd-thread-create"),
          threadId: ThreadId.make("thread-new"),
          projectId: ProjectId.make("project-1"),
          title: "New thread",
          modelSelection: { instanceId: ProviderInstanceId.make("grok"), model: "grok-4.6" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          enabledSkillIds: [],
          subagentPolicy: { mode: "off" },
          createdAt: NOW,
        },
        readModel: makeReadModel(),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.created");
      if (events[0]?.type === "thread.created") {
        expect(events[0].payload.subagentPolicy).toEqual({ mode: "off" });
      }
    }),
  );

  it.effect("thread.subagent-policy.set emits a full replacement", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.subagent-policy.set",
          commandId: CommandId.make("cmd-policy-set"),
          threadId: ThreadId.make("thread-1"),
          policy: { mode: "on", child: { model: "grok-build" } },
          createdAt: NOW,
        },
        readModel: makeReadModel(),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events[0]?.type).toBe("thread.subagent-policy-set");
      if (events[0]?.type === "thread.subagent-policy-set") {
        expect(events[0].payload.policy).toEqual({
          mode: "on",
          child: { model: "grok-build" },
        });
      }
    }),
  );
});
