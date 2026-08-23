import {
  CommandId,
  MessageId,
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

const readModel: OrchestrationReadModel = {
  snapshotSequence: 0,
  projects: [],
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
      enabledSkillIds: [],
      latestTurn: null,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      pinnedAt: null,
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

const startTurn = (commandId: string, delivery?: "steer" | "queue") =>
  decideOrchestrationCommand({
    command: {
      type: "thread.turn.start",
      commandId: CommandId.make(commandId),
      threadId: ThreadId.make("thread-1"),
      message: {
        messageId: MessageId.make("message-1"),
        role: "user",
        text: "Continue",
        attachments: [],
      },
      ...(delivery !== undefined ? { delivery } : {}),
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: NOW,
    },
    readModel,
  }).pipe(
    Effect.map((result) => {
      const events = Array.isArray(result) ? result : [result];
      return events.find((event) => event.type === "thread.turn-start-requested");
    }),
  );

it.layer(NodeServices.layer)("turn delivery decider", (it) => {
  it.effect("carries an explicit delivery mode onto the turn-start-requested payload", () =>
    Effect.gen(function* () {
      const queued = yield* startTurn("cmd-turn-start-queued", "queue");
      expect(queued?.type).toBe("thread.turn-start-requested");
      if (queued?.type === "thread.turn-start-requested") {
        expect(queued.payload.delivery).toBe("queue");
      }
    }),
  );

  it.effect("omits delivery when the client did not ask for one", () =>
    Effect.gen(function* () {
      const steered = yield* startTurn("cmd-turn-start-default");
      expect(steered?.type).toBe("thread.turn-start-requested");
      if (steered?.type === "thread.turn-start-requested") {
        // Absent, not "steer": the reactor's default path keys off undefined.
        expect(steered.payload.delivery).toBeUndefined();
        expect("delivery" in steered.payload).toBe(false);
      }
    }),
  );
});
