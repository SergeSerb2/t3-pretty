// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProjectTransferError,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationThread,
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
  isManagedProjectWorkspace,
  prepareProjectTransfer,
  manifestThreadIds,
  requireMoveSiblingThread,
  sameThreadIdSet,
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

  it("only treats children of the managed projects folder as deletable", () => {
    expect(isManagedProjectWorkspace("/t3/projects/Aerospace-Lingo", "/t3/projects")).toBe(true);
    expect(isManagedProjectWorkspace("/t3/projects/Aerospace-Lingo/nested", "/t3/projects")).toBe(
      true,
    );
    expect(isManagedProjectWorkspace("/t3/projects", "/t3/projects")).toBe(false);
    expect(isManagedProjectWorkspace("/t3/projects-other/Aerospace-Lingo", "/t3/projects")).toBe(
      false,
    );
    expect(isManagedProjectWorkspace("/Users/me/src/Aerospace-Lingo", "/t3/projects")).toBe(false);
  });

  it.effect("prepares a whole-project move manifest", () =>
    Effect.gen(function* () {
      const prepared = yield* prepareProjectTransfer({
        manifest: { ...manifest, version: 2, additionalThreads: [] },
      });
      expect(prepared.destinationPath).toContain("Aerospace-Lingo");
      yield* cancelProjectTransfer({ transferId: prepared.transferId });
    }).pipe(Effect.provide(testLayer)),
  );

  it("refuses to move a sibling that cannot be loaded", () => {
    const idle = requireMoveSiblingThread({
      title: "Sibling",
      detail: manifest.thread,
      shell: { hasPendingApprovals: false, hasPendingUserInput: false },
    });
    expect(idle).toEqual(manifest.thread);

    const missingDetail = requireMoveSiblingThread({
      title: "History",
      detail: undefined,
      shell: { hasPendingApprovals: false },
    });
    expect(missingDetail).toBeInstanceOf(ProjectTransferError);
    expect(missingDetail).toMatchObject({
      reason: "workspace_not_found",
      detail:
        'Could not load "History" to move this project. Try again once it is fully available.',
    });

    const missingShell = requireMoveSiblingThread({
      title: "History",
      detail: manifest.thread,
      shell: undefined,
    });
    expect(missingShell).toBeInstanceOf(ProjectTransferError);
    expect(missingShell).toMatchObject({ reason: "workspace_not_found" });

    const busy: OrchestrationThread = {
      ...manifest.thread,
      title: "Running sibling",
      session: {
        threadId: manifest.thread.id,
        status: "running",
        providerName: null,
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      },
    };
    expect(
      requireMoveSiblingThread({
        title: busy.title,
        detail: busy,
        shell: {},
      }),
    ).toMatchObject({
      reason: "thread_busy",
      detail: 'Wait for "Running sibling" to finish before moving this project.',
    });
    expect(
      requireMoveSiblingThread({
        title: manifest.thread.title,
        detail: manifest.thread,
        shell: { hasPendingApprovals: true },
      }),
    ).toMatchObject({ reason: "thread_busy" });
  });

  it("treats the inspect-time thread set as a lock for move", () => {
    const siblingId = ThreadId.make("sibling-thread");
    const ids = manifestThreadIds({
      ...manifest,
      version: 2,
      additionalThreads: [{ ...manifest.thread, id: siblingId }],
    });
    expect(ids).toEqual([manifest.thread.id, siblingId]);
    expect(sameThreadIdSet(ids, [siblingId, manifest.thread.id])).toBe(true);
    expect(sameThreadIdSet(ids, [manifest.thread.id])).toBe(false);
    expect(sameThreadIdSet(ids, [...ids, ThreadId.make("extra-thread")])).toBe(false);
  });
});
