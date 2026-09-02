// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ProjectTransferManifest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import {
  PROJECT_TRANSFER_UPLOAD_ROUTE_PREFIX,
  cancelProjectTransfer,
  prepareProjectTransfer,
  validateProjectTransferUploadToken,
} from "./ProjectTransfer.ts";

const testLayer = ServerSecretStore.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-project-transfer-" })),
  Layer.provideMerge(NodeServices.layer),
);

const NOW = "2026-08-28T12:00:00.000Z";
const projectId = ProjectId.make("source-project");
const manifest: ProjectTransferManifest = {
  version: 1,
  sourceEnvironmentId: EnvironmentId.make("source-environment"),
  project: {
    id: projectId,
    title: "Aerospace Lingo",
    workspaceRoot: "/source/Aerospace Lingo",
    defaultModelSelection: null,
    faviconPath: null,
    scripts: [],
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  },
  thread: {
    id: ThreadId.make("source-thread"),
    projectId,
    title: "Aerospace Lingo",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    enabledSkillIds: [],
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  },
  includesGitMetadata: true,
  skippedAttachmentCount: 0,
};

describe("ProjectTransfer", () => {
  it.effect("reserves a unique destination and signs a one-use upload path", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const occupied = NodePath.join(config.baseDir, "projects", "Aerospace-Lingo");
      NodeFS.mkdirSync(occupied, { recursive: true });

      const prepared = yield* prepareProjectTransfer({ manifest });
      expect(prepared.destinationPath).toBe(`${occupied}-2`);
      expect(prepared.relativeUrl).toMatch(
        new RegExp(`^${PROJECT_TRANSFER_UPLOAD_ROUTE_PREFIX}/[^.]+\\.[^.]+$`),
      );

      const token = prepared.relativeUrl.slice(`${PROJECT_TRANSFER_UPLOAD_ROUTE_PREFIX}/`.length);
      expect(yield* validateProjectTransferUploadToken(token)).toMatchObject({
        kind: "project-transfer-upload",
        transferId: prepared.transferId,
      });
      expect(yield* cancelProjectTransfer({ transferId: prepared.transferId })).toEqual({
        cancelled: true,
      });
      expect(yield* cancelProjectTransfer({ transferId: prepared.transferId })).toEqual({
        cancelled: false,
      });
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects expired and tampered upload paths", () =>
    Effect.gen(function* () {
      const prepared = yield* prepareProjectTransfer({ manifest });
      const token = prepared.relativeUrl.slice(`${PROJECT_TRANSFER_UPLOAD_ROUTE_PREFIX}/`.length);
      const [payload, signature] = token.split(".");
      expect(yield* validateProjectTransferUploadToken(`${payload}x.${signature}`)).toBeNull();

      yield* TestClock.adjust("61 minutes");
      expect(yield* validateProjectTransferUploadToken(token)).toBeNull();
      yield* cancelProjectTransfer({ transferId: prepared.transferId });
    }).pipe(Effect.provide(testLayer)),
  );
});
