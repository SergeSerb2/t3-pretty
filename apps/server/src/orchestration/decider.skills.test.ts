import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type SkillId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";

const SKILL_A: SkillId = "acme/skills:skill-a";
const SKILL_B: SkillId = "acme/skills:skill-b";

function makeReadModel(input?: {
  readonly enabledSkillIds?: ReadonlyArray<SkillId>;
  readonly archivedAt?: string | null;
}): OrchestrationReadModel {
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
        modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: input?.archivedAt ?? null,
        settledOverride: null,
        settledAt: null,
        snoozedUntil: null,
        snoozedAt: null,
        pinnedAt: null,
        pinOrderKey: null,
        scenery: null,
        enabledSkillIds: [...(input?.enabledSkillIds ?? [])],
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

it.layer(NodeServices.layer)("skills decider", (it) => {
  it.effect("thread.create carries enabledSkillIds into thread.created", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.make("cmd-thread-create"),
          threadId: ThreadId.make("thread-new"),
          projectId: ProjectId.make("project-1"),
          title: "New thread",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          enabledSkillIds: [SKILL_A],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread.created");
      if (events[0]?.type === "thread.created") {
        expect(events[0].payload.enabledSkillIds).toEqual([SKILL_A]);
        expect(events[0].payload.updatedAt).toBe(NOW);
      }
    }),
  );

  it.effect("thread.skills.set emits thread.skills-set with the full replacement set", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.skills.set",
          commandId: CommandId.make("cmd-skills-set"),
          threadId: ThreadId.make("thread-1"),
          enabledSkillIds: [SKILL_B],
          createdAt: NOW,
        },
        readModel: makeReadModel({ enabledSkillIds: [SKILL_A] }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe("thread.skills-set");
      if (events[0]?.type === "thread.skills-set") {
        expect(events[0].payload.threadId).toBe(ThreadId.make("thread-1"));
        expect(events[0].payload.enabledSkillIds).toEqual([SKILL_B]);
        expect(events[0].payload.updatedAt).not.toBe(NOW);
      }
    }),
  );

  it.effect("thread.skills.set can clear the set, and works on archived threads", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.skills.set",
          commandId: CommandId.make("cmd-skills-clear"),
          threadId: ThreadId.make("thread-1"),
          enabledSkillIds: [],
          createdAt: NOW,
        },
        readModel: makeReadModel({ enabledSkillIds: [SKILL_A], archivedAt: NOW }),
      });
      const events = Array.isArray(event) ? event : [event];
      expect(events.map((entry) => entry.type)).toEqual(["thread.skills-set"]);
      if (events[0]?.type === "thread.skills-set") {
        expect(events[0].payload.enabledSkillIds).toEqual([]);
      }
    }),
  );

  it.effect("rejects thread.skills.set for an unknown thread", () =>
    Effect.gen(function* () {
      const error = yield* decideOrchestrationCommand({
        command: {
          type: "thread.skills.set",
          commandId: CommandId.make("cmd-skills-missing"),
          threadId: ThreadId.make("thread-missing"),
          enabledSkillIds: [SKILL_A],
          createdAt: NOW,
        },
        readModel: makeReadModel(),
      }).pipe(Effect.flip);
      expect(error._tag).toBe("OrchestrationCommandInvariantError");
    }),
  );
});
