import { beforeEach, afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import * as Option from "effect/Option";
import {
  EnvironmentId,
  ThreadId,
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { makeThreadProjectionFixture, makeThreadShellFixture } from "../test-fixtures";
import type { QueuedThreadMessage } from "./thread-outbox-model";

const state = vi.hoisted(() => ({
  loads: [] as string[],
  shell: undefined as Atom.Writable<EnvironmentThreadShell | null> | undefined,
  projection: undefined as OrchestrationV2ThreadProjection | undefined,
}));
vi.mock("../connection/catalog", () => ({ environmentCatalog: {} }));
vi.mock("../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("./automations", () => ({ automationEnvironment: {} }));
vi.mock("./shell", () => ({ environmentSnapshotAtom: {} }));
vi.mock("./thread-outbox", async () => {
  const { Atom } = await import("effect/reactivity");
  return {
    threadOutboxManager: {
      queuedMessagesByThreadKeyAtom: Atom.make<
        Readonly<Record<string, readonly QueuedThreadMessage[]>>
      >({}),
    },
  };
});
vi.mock("@t3tools/client-runtime/state/threads", async (importOriginal) => {
  const original = await importOriginal<typeof import("@t3tools/client-runtime/state/threads")>();
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const Option = await import("effect/Option");
  state.shell = Atom.make<EnvironmentThreadShell | null>(null);
  const raw = Atom.family((key: string) =>
    Atom.make(() => {
      state.loads.push(key);
      return AsyncResult.success({
        ...original.EMPTY_ENVIRONMENT_THREAD_STATE,
        status: "live" as const,
        data: Option.some(state.projection!),
      });
    }).pipe(Atom.setIdleTTL(0)),
  );
  return {
    ...original,
    createThreadEnvironmentAtoms: () => ({}),
    createEnvironmentThreadShellAtoms: () => ({ threadShellAtom: () => state.shell! }),
    createEnvironmentThreadStateAtoms: () => ({
      stateAtom: (environmentId: string, threadId: string) => raw(`${environmentId}:${threadId}`),
    }),
  };
});

import { environmentThreads, environmentThreadDetails } from "./threads";
import { threadOutboxManager } from "./thread-outbox";
import { pendingThreadCreationOutcomesAtom } from "./pending-thread-creation";

const ref = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const key = `${ref.environmentId}:${ref.threadId}`;
const creation: QueuedThreadMessage = {
  ...ref,
  messageId: MessageId.make("message-1"),
  commandId: CommandId.make("command-1"),
  text: "Ask for input",
  attachments: [],
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6.1-sol" },
  runtimeMode: "full-access",
  creation: {
    projectId: ProjectId.make("project-1"),
    workspaceMode: "local",
    branch: null,
    worktreePath: null,
  },
  createdAt: "2026-10-14T22:00:00.000Z",
};
let registry: AtomRegistry.AtomRegistry;
const disposers: Array<() => void> = [];
function mountReaders() {
  // The route, model label, queue controls, and agent badge all own readers.
  const readers: ReadonlyArray<Atom.Atom<unknown>> = [
    environmentThreads.stateAtom(ref.environmentId, ref.threadId),
    environmentThreadDetails.threadAtom(ref),
    environmentThreadDetails.queuedCountAtom(ref),
    environmentThreadDetails.queueWorkflowAtom(ref),
    environmentThreadDetails.turnSubagentsAtom(ref),
    environmentThreadDetails.pendingRequestsAtom(ref),
    environmentThreadDetails.visibleTurnItemsAtom(ref),
  ];
  for (const atom of readers) disposers.push(registry.mount(atom));
}
beforeEach(() => {
  registry = AtomRegistry.make();
  state.loads = [];
  state.projection = makeThreadProjectionFixture({ id: ref.threadId });
  registry.set(threadOutboxManager.queuedMessagesByThreadKeyAtom, { [key]: [creation] });
});
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  registry.dispose();
});
describe("mobile thread creation detail subscriptions", () => {
  it("holds every detail reader until creation is delivered, then loads the conversation", () => {
    mountReaders();
    expect(state.loads).toEqual([]);
    expect(registry.get(environmentThreadDetails.threadAtom(ref))).toBeNull();

    registry.set(pendingThreadCreationOutcomesAtom, {
      [key]: { kind: "delivered", message: creation },
    });
    const detail = registry.get(environmentThreadDetails.threadAtom(ref));
    expect(detail?.projection.thread.id).toBe(ref.threadId);
    expect(state.loads).toEqual([key]);

    registry.set(threadOutboxManager.queuedMessagesByThreadKeyAtom, {});
    registry.set(pendingThreadCreationOutcomesAtom, {});
    expect(registry.get(environmentThreadDetails.threadAtom(ref))).toBe(detail);
  });
  it("allows the authoritative shell to release detail before outbox cleanup", () => {
    mountReaders();
    expect(state.loads).toEqual([]);
    registry.set(
      state.shell!,
      makeThreadShellFixture({ environmentId: ref.environmentId, id: ref.threadId }),
    );
    expect(registry.get(environmentThreadDetails.threadAtom(ref))?.projection.thread.id).toBe(
      ref.threadId,
    );
    expect(state.loads).toEqual([key]);
  });
  it("does not load a failed creation after the outbox restores its draft", () => {
    registry.set(threadOutboxManager.queuedMessagesByThreadKeyAtom, {});
    registry.set(pendingThreadCreationOutcomesAtom, {
      [key]: { kind: "failed", message: creation, reason: "Setup failed" },
    });
    mountReaders();
    expect(state.loads).toEqual([]);
  });
  it("loads cold deep links and existing threads with queued follow-ups", () => {
    const { creation: _creation, ...followUp } = creation;
    registry.set(threadOutboxManager.queuedMessagesByThreadKeyAtom, { [key]: [followUp] });
    mountReaders();
    expect(state.loads).toEqual([key]);
    const value = AsyncResult.value(
      registry.get(environmentThreads.stateAtom(ref.environmentId, ref.threadId)),
    );
    expect(Option.isSome(value) && value.value.status).toBe("live");
  });
});
