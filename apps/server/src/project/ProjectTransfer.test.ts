// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProjectTransferError,
  ThreadId,
  type OrchestrationV2ThreadProjection,
  ProjectTransferManifest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import { TRANSFER_TEST_NOW, transferProjection, transferRun } from "./ProjectTransfer.testkit.ts";

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

const encodeManifest = Schema.encodeEffect(ProjectTransferManifest);
const decodeManifest = Schema.decodeEffect(ProjectTransferManifest);

const testLayer = ServerSecretStore.layer.pipe(
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-project-transfer-" })),
  Layer.provideMerge(NodeServices.layer),
);

const NOW = TRANSFER_TEST_NOW;
const projectId = ProjectId.make("source-project");
const manifest: ProjectTransferManifest = {
  version: 3,
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
  thread: transferProjection(),
  includesGitMetadata: true,
  skippedAttachmentCount: 0,
};

describe("ProjectTransfer", () => {
  it.effect("reserves a unique destination and signs a one-use upload path", () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const occupied = NodePath.join(config.baseDir, "projects", "Aerospace-Lingo");
      NodeFS.mkdirSync(occupied, { recursive: true });

      const prepared = yield* prepareProjectTransfer({
        manifest: yield* encodeManifest(manifest).pipe(Effect.flatMap(decodeManifest)),
      });
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
      const prepared = yield* prepareProjectTransfer({
        manifest: yield* encodeManifest(manifest).pipe(Effect.flatMap(decodeManifest)),
      });
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
        manifest: { ...manifest, version: 3, additionalThreads: [] },
      });
      expect(prepared.destinationPath).toContain("Aerospace-Lingo");
      yield* cancelProjectTransfer({ transferId: prepared.transferId });
    }).pipe(Effect.provide(testLayer)),
  );

  it("refuses to move a sibling that cannot be loaded", () => {
    const idle = requireMoveSiblingThread({
      title: "Sibling",
      detail: manifest.thread,
      shell: { pendingRuntimeRequest: null },
    });
    expect(idle).toEqual(manifest.thread);

    const missingDetail = requireMoveSiblingThread({
      title: "History",
      detail: undefined,
      shell: { pendingRuntimeRequest: null },
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

    const busy: OrchestrationV2ThreadProjection = {
      ...manifest.thread,
      thread: { ...manifest.thread.thread, title: "Running sibling" },
      runs: [transferRun(manifest.thread, "running")],
    };
    expect(
      requireMoveSiblingThread({
        title: busy.thread.title,
        detail: busy,
        shell: { pendingRuntimeRequest: null },
      }),
    ).toMatchObject({
      reason: "thread_busy",
      detail: 'Wait for "Running sibling" to finish before moving this project.',
    });
    expect(
      requireMoveSiblingThread({
        title: manifest.thread.thread.title,
        detail: manifest.thread,
        shell: { pendingRuntimeRequest: { kind: "approval" } },
      }),
    ).toMatchObject({ reason: "thread_busy" });
  });

  it("treats the inspect-time thread set as a lock for move", () => {
    const siblingId = ThreadId.make("sibling-thread");
    const ids = manifestThreadIds({
      ...manifest,
      version: 3,
      additionalThreads: [
        { ...manifest.thread, thread: { ...manifest.thread.thread, id: siblingId } },
      ],
    });
    expect(ids).toEqual([manifest.thread.thread.id, siblingId]);
    expect(sameThreadIdSet(ids, [siblingId, manifest.thread.thread.id])).toBe(true);
    expect(sameThreadIdSet(ids, [manifest.thread.thread.id])).toBe(false);
    expect(sameThreadIdSet(ids, [...ids, ThreadId.make("extra-thread")])).toBe(false);
  });
});

it("blocks a project move throughout every active V2 run phase", () => {
  for (const status of ["queued", "preparing", "starting", "running", "waiting"] as const) {
    const projection = { ...manifest.thread, runs: [transferRun(manifest.thread, status)] };
    expect(
      requireMoveSiblingThread({
        title: projection.thread.title,
        detail: projection,
        shell: { pendingRuntimeRequest: null },
      }),
    ).toMatchObject({ reason: "thread_busy" });
  }
});
