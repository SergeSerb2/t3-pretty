import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import {
  AuthFilesystemReadScope,
  CheckpointRef,
  EnvironmentId,
  MessageId,
  ThreadId,
  RunId,
  type AuthSessionState,
  type ReviewDiffPreviewResult,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  session: null as Pick<AuthSessionState, "authenticated" | "scopes"> | null,
  sessionError: null as string | null,
  sessionAtom: {},
  previewAtom: {},
  preview: {
    data: null as ReviewDiffPreviewResult | null,
    error: null as string | null,
    isPending: false,
  },
  effects: [] as Array<() => void>,
  checkpoints: [] as ReadonlyArray<ThreadCheckpointSummary>,
}));

vi.mock("@t3tools/client-runtime/state/thread-checkpoints", () => ({
  deriveThreadCheckpointSummaries: () => state.checkpoints,
}));
vi.mock("react", () => ({
  useCallback: <A>(callback: A) => callback,
  useEffect: (effect: () => void) => state.effects.push(effect),
  useMemo: <A>(factory: () => A) => factory(),
}));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: () => state.sessionAtom },
}));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({
    isReady: true,
    presentation: { connection: { phase: "connected", error: null } },
  }),
}));
vi.mock("../../state/use-thread-detail", () => ({
  useSelectedThreadProjection: () => ({ projection: {} }),
}));
vi.mock("../../state/use-selected-thread-worktree", () => ({
  useSelectedThreadWorktree: () => ({ selectedThreadCwd: "/repo" }),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) =>
    atom === state.previewAtom
      ? { ...state.preview, refresh: vi.fn() }
      : {
          data: atom === state.sessionAtom ? state.session : null,
          error: atom === state.sessionAtom ? state.sessionError : null,
          isPending: atom === state.sessionAtom && state.session === null,
          refresh: vi.fn(),
        },
}));
vi.mock("../../state/queries", () => ({
  useCheckpointDiff: () => ({ data: null, error: null, isPending: false, refresh: vi.fn() }),
}));
vi.mock("../../state/review", () => ({
  reviewEnvironment: { diffPreview: vi.fn(() => state.previewAtom) },
}));
vi.mock("./reviewState", () => ({
  setReviewAsyncError: vi.fn(),
  setReviewGitSections: vi.fn(),
  setReviewSelectedSectionId: vi.fn(),
  setReviewTurnDiff: vi.fn(),
  setReviewTurnDiffLoading: vi.fn(),
}));

import { setReviewSelectedSectionId, type ReviewCacheForThread } from "./reviewState";
import { useReviewSections } from "./useReviewSections";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(setReviewSelectedSectionId).mockReset();
  state.effects = [];
  state.session = { authenticated: true, scopes: [AuthFilesystemReadScope] };
  state.sessionError = null;
  state.preview = { data: null, error: null, isPending: false };
  state.checkpoints = [
    {
      runId: RunId.make("turn-1"),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread/1"),
      status: "ready",
      files: [],
      assistantMessageId: MessageId.make("message-1"),
      completedAt: "2026-04-01T00:00:00.000Z",
    },
  ];
});

const checkpointDiff = "diff --git a/checkpoint.ts b/checkpoint.ts";
const localDiff = "diff --git a/local.ts b/local.ts";
function makeReviewCache(
  kind: "working-tree" | "branch-range" = "working-tree",
): ReviewCacheForThread {
  return {
    threadKey: "environment:thread",
    gitSections: [
      {
        id: kind,
        kind,
        title: "Dirty worktree",
        baseRef: "HEAD",
        headRef: null,
        diff: localDiff,
        diffHash: "cached-local",
        truncated: false,
      },
    ],
    turnDiffById: { "turn:1": checkpointDiff },
    selectedSectionId: `git:${kind}`,
    asyncState: { loadingTurnIds: {}, error: null },
    expandedFileIdsBySection: {},
    revealedLargeFileIdsBySection: {},
    viewedFileIdsBySection: {},
  };
}

function makeInput(reviewCache = makeReviewCache()) {
  return {
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    reviewCache,
  };
}

function renderSections(input: ReturnType<typeof makeInput>) {
  const result = useReviewSections(input);
  const effects = state.effects.splice(0);
  effects.forEach((effect) => effect());
  return result;
}

it("hides cached local diffs after file access is lost while retaining checkpoint diffs", () => {
  const input = makeInput();
  expect(renderSections(input).selectedSection?.diff).toBe(localDiff);

  state.session = { authenticated: true, scopes: [] };
  const denied = renderSections(input);
  expect(denied.reviewSections.map((section) => section.id)).toEqual(["turn:1"]);
  expect(denied.selectedSection?.diff).toBe(checkpointDiff);

  expect(setReviewSelectedSectionId).toHaveBeenCalledWith("environment:thread", "turn:1");
});

it.each(["working-tree", "branch-range"] as const)(
  "preserves a cached %s selection while an expired grant reloads",
  (kind) => {
    const input = makeInput(makeReviewCache(kind));
    expect(renderSections(input).selectedSection?.diff).toBe(localDiff);

    state.session = null;
    const pending = renderSections(input);
    expect(pending.selectedSection).toEqual(
      expect.objectContaining({ id: `git:${kind}`, diff: null, isLoading: true }),
    );
    expect(pending.loadingGitDiffs).toBe(true);
    expect(pending.reviewSections.find((section) => section.id === "turn:1")?.diff).toBe(
      checkpointDiff,
    );
    expect(setReviewSelectedSectionId).not.toHaveBeenCalled();

    state.session = { authenticated: true, scopes: [AuthFilesystemReadScope] };
    expect(renderSections(input).selectedSection).toEqual(
      expect.objectContaining({ id: `git:${kind}`, diff: localDiff, isLoading: false }),
    );
    expect(setReviewSelectedSectionId).not.toHaveBeenCalled();
  },
);

it("falls back to a checkpoint when a pending grant resolves without file access", () => {
  const input = makeInput();
  state.session = null;
  renderSections(input);
  expect(setReviewSelectedSectionId).not.toHaveBeenCalled();

  state.session = { authenticated: true, scopes: [] };
  const denied = renderSections(input);
  expect(denied.reviewSections.map((section) => section.id)).toEqual(["turn:1"]);
  expect(denied.selectedSection?.diff).toBe(checkpointDiff);
  expect(setReviewSelectedSectionId).toHaveBeenCalledWith("environment:thread", "turn:1");
});

it("reports a failed access check when no checkpoint can replace the local review", () => {
  state.checkpoints = [];
  const input = makeInput();
  expect(renderSections(input).selectedSection?.diff).toBe(localDiff);

  state.sessionError = "The session request timed out.";
  const unavailable = renderSections(input);
  expect(unavailable.selectedSection).toBeNull();
  expect(unavailable.reviewSections).toEqual([]);
  expect(unavailable.error).toBe(state.sessionError);
});

it("reports denied file access when no checkpoint can replace the local review", () => {
  state.checkpoints = [];
  const input = makeInput();
  expect(renderSections(input).selectedSection?.diff).toBe(localDiff);

  state.session = { authenticated: true, scopes: [] };
  const denied = renderSections(input);
  expect(denied.selectedSection).toBeNull();
  expect(denied.reviewSections).toEqual([]);
  expect(denied.loadingGitDiffs).toBe(false);
  expect(denied.error).toBe("This connection cannot read local diffs.");
});

it("keeps a cached checkpoint available when the filesystem access check fails", () => {
  state.sessionError = "The session request timed out.";
  const checkpoint = renderSections(makeInput());
  expect(checkpoint.selectedSection?.diff).toBe(checkpointDiff);
  expect(checkpoint.error).toBeNull();
});

it.each(["working-tree", "branch-range"] as const)(
  "keeps the %s selection when expired review payloads reload on reopen",
  (kind) => {
    const input = makeInput(makeReviewCache(kind));
    expect(renderSections(input).selectedSection?.id).toBe(`git:${kind}`);
    vi.mocked(setReviewSelectedSectionId).mockImplementation((_threadKey, selectedSectionId) => {
      input.reviewCache = { ...input.reviewCache, selectedSectionId };
    });

    // Raw Git and turn payloads expired while selection still remains cached.
    input.reviewCache = { ...input.reviewCache, gitSections: [], turnDiffById: {} };
    state.preview.isPending = true;
    const pending = renderSections(input);
    expect(pending.selectedSection).toEqual(
      expect.objectContaining({ id: `git:${kind}`, diff: null, isLoading: true }),
    );
    expect(setReviewSelectedSectionId).not.toHaveBeenCalled();

    state.preview = {
      data: {
        cwd: "/repo",
        generatedAt: DateTime.makeUnsafe("2026-10-13T00:00:00Z"),
        sources: [
          ...makeReviewCache("branch-range").gitSections,
          ...makeReviewCache("working-tree").gitSections,
        ],
      },
      isPending: false,
      error: null,
    };
    const loaded = renderSections(input);
    expect(loaded.selectedSection).toEqual(
      expect.objectContaining({ id: `git:${kind}`, diff: localDiff, isLoading: false }),
    );
    expect(setReviewSelectedSectionId).not.toHaveBeenCalled();
  },
);

it("validates a retained Git selection after fresh sources finish loading", () => {
  const input = makeInput({ ...makeReviewCache(), gitSections: [] });
  vi.mocked(setReviewSelectedSectionId).mockImplementation((_threadKey, selectedSectionId) => {
    input.reviewCache = { ...input.reviewCache, selectedSectionId };
  });
  state.preview.isPending = true;
  renderSections(input);
  expect(setReviewSelectedSectionId).not.toHaveBeenCalled();

  state.preview = {
    data: {
      cwd: "/repo",
      generatedAt: DateTime.makeUnsafe("2026-10-13T00:00:00Z"),
      sources: makeReviewCache("branch-range").gitSections,
    },
    isPending: false,
    error: null,
  };
  renderSections(input);
  expect(setReviewSelectedSectionId).toHaveBeenCalledWith("environment:thread", "git:branch-range");
  expect(renderSections(input).selectedSection?.id).toBe("git:branch-range");
});
