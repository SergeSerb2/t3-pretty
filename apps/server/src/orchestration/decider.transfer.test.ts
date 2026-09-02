import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-08-28T12:00:00.000Z";
const SOURCE_TIME = "2026-08-27T12:00:00.000Z";
const projectId = ProjectId.make("project-transferred");
const threadId = ThreadId.make("thread-transferred");
const turnId = TurnId.make("turn-transferred");

const thread: OrchestrationThread = {
  id: threadId,
  projectId,
  title: "Aerospace Lingo",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: "main",
  worktreePath: null,
  latestTurn: null,
  createdAt: SOURCE_TIME,
  updatedAt: NOW,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
  enabledSkillIds: [],
  messages: [
    {
      id: MessageId.make("message-transferred"),
      role: "user",
      text: "Teach me the phonetic alphabet.",
      attachments: [],
      turnId,
      streaming: false,
      createdAt: SOURCE_TIME,
      updatedAt: SOURCE_TIME,
    },
  ],
  proposedPlans: [],
  activities: [
    {
      id: EventId.make("activity-transferred"),
      tone: "info",
      kind: "thread.transferred",
      summary: "Transferred from another environment",
      payload: {},
      turnId: null,
      createdAt: NOW,
    },
  ],
  checkpoints: [],
  session: null,
};

it.layer(NodeServices.layer)("project transfer import", (it) => {
  it.effect("creates the project and thread together with conversation history", () =>
    Effect.gen(function* () {
      const result = yield* decideOrchestrationCommand({
        command: {
          type: "project.transfer.import",
          commandId: CommandId.make("command-transfer"),
          project: {
            id: projectId,
            title: "Aerospace Lingo",
            workspaceRoot: "/tmp/projects/Aerospace-Lingo",
            defaultModelSelection: null,
            defaultThreadEnvMode: "local",
            faviconPath: null,
            scripts: [],
            createdAt: SOURCE_TIME,
            updatedAt: NOW,
            deletedAt: null,
          },
          thread,
          sourceEnvironmentId: EnvironmentId.make("source-environment"),
          sourceThreadId: ThreadId.make("source-thread"),
          includesGitMetadata: true,
          skippedAttachmentCount: 1,
          importedAt: NOW,
        },
        readModel: createEmptyReadModel(NOW),
      });

      expect(Array.isArray(result)).toBe(true);
      const events = Array.isArray(result) ? result : [result];
      expect(events.map((event) => event.type)).toEqual(["project.created", "thread.transferred"]);

      let projected = createEmptyReadModel(NOW);
      for (const [index, event] of events.entries()) {
        projected = yield* projectEvent(projected, { ...event, sequence: index + 1 });
      }

      expect(projected.projects[0]).toMatchObject({
        id: projectId,
        title: "Aerospace Lingo",
        defaultThreadEnvMode: "local",
      });
      expect(projected.threads[0]).toMatchObject({
        id: threadId,
        projectId,
        title: "Aerospace Lingo",
        branch: "main",
        messages: [{ text: "Teach me the phonetic alphabet.", turnId }],
        activities: [{ kind: "thread.transferred" }],
        checkpoints: [],
        session: null,
      });
      expect(projected.threads[0]?.branchEventId).toBe(events[1]?.eventId);
    }),
  );
});
