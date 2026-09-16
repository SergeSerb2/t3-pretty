import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type ScopedThreadRef, TurnId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveLocalStorage } from "./lib/storage";

export type DiffPanelSelection =
  | { kind: "branch"; baseRef: string | null }
  | { kind: "unstaged" }
  | { kind: "turn"; turnId: TurnId; filePath: string | null; revealRequestId: number };

export type DiffRenderMode = "stacked" | "split";

const DEFAULT_SELECTION: DiffPanelSelection = { kind: "branch", baseRef: null };
const DEFAULT_WORKING_TREE_SELECTION: DiffPanelSelection = { kind: "unstaged" };

interface DiffPanelStoreState {
  byThreadKey: Record<string, DiffPanelSelection>;
  branchBaseRefByThreadKey: Record<string, string | null>;
  diffRenderMode: DiffRenderMode;
  setDiffRenderMode: (mode: DiffRenderMode) => void;
  selectGitScope: (ref: ScopedThreadRef, scope: "branch" | "unstaged") => void;
  selectBranchBaseRef: (ref: ScopedThreadRef, baseRef: string | null) => void;
  selectTurn: (ref: ScopedThreadRef, turnId: TurnId, filePath?: string) => void;
  reconcileTurnSelection: (ref: ScopedThreadRef, availableTurnIds: ReadonlyArray<TurnId>) => void;
  removeThread: (ref: ScopedThreadRef) => void;
}

function normalizeBaseRef(baseRef: string | null): string | null {
  const normalized = baseRef?.trim();
  return normalized ? normalized : null;
}

function sanitizePersistedDiffSelection(value: unknown): DiffPanelSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const selection = value as Record<string, unknown>;
  switch (selection.kind) {
    case "branch":
      return {
        kind: "branch",
        baseRef: typeof selection.baseRef === "string" ? normalizeBaseRef(selection.baseRef) : null,
      };
    case "unstaged":
      return { kind: "unstaged" };
    case "turn":
      if (typeof selection.turnId !== "string" || selection.turnId.length === 0) return null;
      return {
        kind: "turn",
        turnId: TurnId.make(selection.turnId),
        filePath: typeof selection.filePath === "string" ? selection.filePath.trim() || null : null,
        revealRequestId:
          typeof selection.revealRequestId === "number" &&
          Number.isSafeInteger(selection.revealRequestId) &&
          selection.revealRequestId >= 0
            ? selection.revealRequestId
            : 0,
      };
    default:
      return null;
  }
}

export function migratePersistedDiffPanelState(
  persistedState: unknown,
): Pick<DiffPanelStoreState, "byThreadKey" | "branchBaseRefByThreadKey" | "diffRenderMode"> {
  if (!persistedState || typeof persistedState !== "object" || Array.isArray(persistedState)) {
    return { byThreadKey: {}, branchBaseRefByThreadKey: {}, diffRenderMode: "stacked" };
  }
  const candidate = persistedState as Record<string, unknown>;
  const rawSelections =
    candidate.byThreadKey &&
    typeof candidate.byThreadKey === "object" &&
    !Array.isArray(candidate.byThreadKey)
      ? (candidate.byThreadKey as Record<string, unknown>)
      : {};
  const byThreadKey = Object.fromEntries(
    Object.entries(rawSelections).flatMap(([threadKey, value]) => {
      if (!parseScopedThreadKey(threadKey)) return [];
      const selection = sanitizePersistedDiffSelection(value);
      return selection ? [[threadKey, selection] as const] : [];
    }),
  );
  const rawBaseRefs =
    candidate.branchBaseRefByThreadKey &&
    typeof candidate.branchBaseRefByThreadKey === "object" &&
    !Array.isArray(candidate.branchBaseRefByThreadKey)
      ? (candidate.branchBaseRefByThreadKey as Record<string, unknown>)
      : {};
  const branchBaseRefByThreadKey = Object.fromEntries(
    Object.entries(rawBaseRefs).flatMap(([threadKey, value]) => {
      if (!parseScopedThreadKey(threadKey)) return [];
      if (value === null) return [[threadKey, null] as const];
      if (typeof value !== "string") return [];
      return [[threadKey, normalizeBaseRef(value)] as const];
    }),
  );
  return {
    byThreadKey,
    branchBaseRefByThreadKey,
    diffRenderMode: candidate.diffRenderMode === "split" ? "split" : "stacked",
  };
}

export const useDiffPanelStore = create<DiffPanelStoreState>()(
  persist(
    (set) => ({
      byThreadKey: {},
      branchBaseRefByThreadKey: {},
      diffRenderMode: "stacked",
      setDiffRenderMode: (diffRenderMode) => set({ diffRenderMode }),
      selectGitScope: (ref, scope) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          const previousBaseRef =
            previous?.kind === "branch"
              ? previous.baseRef
              : (state.branchBaseRefByThreadKey[threadKey] ?? null);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]:
                scope === "branch"
                  ? { kind: "branch", baseRef: previousBaseRef }
                  : { kind: "unstaged" },
            },
            branchBaseRefByThreadKey:
              previous?.kind === "branch"
                ? { ...state.branchBaseRefByThreadKey, [threadKey]: previous.baseRef }
                : state.branchBaseRefByThreadKey,
          };
        }),
      selectBranchBaseRef: (ref, baseRef) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const normalizedBaseRef = normalizeBaseRef(baseRef);
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { kind: "branch", baseRef: normalizedBaseRef },
            },
            branchBaseRefByThreadKey: {
              ...state.branchBaseRefByThreadKey,
              [threadKey]: normalizedBaseRef,
            },
          };
        }),
      selectTurn: (ref, turnId, filePath) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: {
                kind: "turn",
                turnId,
                filePath: filePath?.trim() || null,
                revealRequestId: previous?.kind === "turn" ? previous.revealRequestId + 1 : 1,
              },
            },
          };
        }),
      reconcileTurnSelection: (ref, availableTurnIds) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          const previous = state.byThreadKey[threadKey];
          const latestTurnId = availableTurnIds[0];
          if (
            previous?.kind !== "turn" ||
            latestTurnId === undefined ||
            availableTurnIds.includes(previous.turnId)
          ) {
            return state;
          }
          return {
            byThreadKey: {
              ...state.byThreadKey,
              [threadKey]: { ...previous, turnId: latestTurnId },
            },
          };
        }),
      removeThread: (ref) =>
        set((state) => {
          const threadKey = scopedThreadKey(ref);
          if (!(threadKey in state.byThreadKey) && !(threadKey in state.branchBaseRefByThreadKey)) {
            return state;
          }
          const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
          const { [threadKey]: _removedBaseRef, ...branchBaseRefByThreadKey } =
            state.branchBaseRefByThreadKey;
          return { byThreadKey, branchBaseRefByThreadKey };
        }),
    }),
    {
      name: "t3code:diff-panel-state:v1",
      version: 1,
      storage: createJSONStorage(resolveLocalStorage),
      partialize: (state) => ({
        byThreadKey: state.byThreadKey,
        branchBaseRefByThreadKey: state.branchBaseRefByThreadKey,
        diffRenderMode: state.diffRenderMode,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...migratePersistedDiffPanelState(persistedState),
      }),
    },
  ),
);

export function selectThreadDiffPanelSelection(
  byThreadKey: Record<string, DiffPanelSelection>,
  ref: ScopedThreadRef | null | undefined,
  hasWorkingTreeChanges = false,
): DiffPanelSelection {
  if (!ref) return DEFAULT_SELECTION;
  return (
    byThreadKey[scopedThreadKey(ref)] ??
    (hasWorkingTreeChanges ? DEFAULT_WORKING_TREE_SELECTION : DEFAULT_SELECTION)
  );
}
