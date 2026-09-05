import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  ENTITY_ID_MAX_LENGTH,
  EnvironmentId,
  ThreadId,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import type { DraftId } from "./composerDraftStore";

/** Legacy draft ids may be the concatenated `<environmentId>:<threadId>` key. */
export const DRAFT_ROUTE_ID_MAX_LENGTH = ENTITY_ID_MAX_LENGTH * 2 + 1;

export type ThreadRouteTarget =
  | {
      kind: "server";
      threadRef: ScopedThreadRef;
    }
  | {
      kind: "draft";
      draftId: DraftId;
    };

type DraftThreadRouteState = {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  promotedTo?: ScopedThreadRef | null;
};

export type ThreadRouteRenderState = "loading" | "ready" | "missing";

export const MISSING_THREAD_REDIRECT_GRACE_MS = 10_000;

export function shouldRedirectMissingThreadRoute(input: {
  readonly renderState: ThreadRouteRenderState;
  readonly environmentHasAnyThreads: boolean;
  readonly transferInProgress: boolean;
  readonly threadDeleted: boolean;
  readonly missingForMs: number;
  readonly graceMs?: number;
}): boolean {
  if (input.renderState !== "missing" || !input.environmentHasAnyThreads) {
    return false;
  }
  if (input.transferInProgress) {
    return false;
  }
  if (input.threadDeleted) {
    return true;
  }
  return input.missingForMs >= (input.graceMs ?? MISSING_THREAD_REDIRECT_GRACE_MS);
}

export function resolveThreadRouteRenderState(input: {
  bootstrapComplete: boolean;
  serverThreadShellExists: boolean;
  serverThreadDetailExists: boolean;
  serverThreadDetailDeleted: boolean;
  draftThreadExists: boolean;
}): ThreadRouteRenderState {
  if (!input.bootstrapComplete) {
    return "loading";
  }
  if (input.serverThreadDetailExists || input.draftThreadExists) {
    return "ready";
  }
  if (input.serverThreadDetailDeleted) {
    return "missing";
  }
  return input.serverThreadShellExists ? "loading" : "missing";
}

export function buildThreadRouteParams(ref: ScopedThreadRef): {
  environmentId: EnvironmentId;
  threadId: ThreadId;
} {
  return {
    environmentId: ref.environmentId,
    threadId: ref.threadId,
  };
}

export function buildDraftThreadRouteParams(draftId: DraftId): {
  draftId: DraftId;
} {
  return { draftId };
}

function isCanonicalRouteId(value: string | undefined, maximumLength: number): value is string {
  return (
    value !== undefined &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value.trim() === value
  );
}

export function resolveThreadRouteRef(
  params: Partial<Record<"environmentId" | "threadId", string | undefined>>,
): ScopedThreadRef | null {
  if (
    !isCanonicalRouteId(params.environmentId, ENTITY_ID_MAX_LENGTH) ||
    !isCanonicalRouteId(params.threadId, ENTITY_ID_MAX_LENGTH)
  ) {
    return null;
  }

  return scopeThreadRef(EnvironmentId.make(params.environmentId), ThreadId.make(params.threadId));
}

export function resolveThreadRouteTarget(
  params: Partial<Record<"environmentId" | "threadId" | "draftId", string | undefined>>,
): ThreadRouteTarget | null {
  if (params.environmentId && params.threadId) {
    const threadRef = resolveThreadRouteRef(params);
    if (!threadRef) {
      return null;
    }
    return {
      kind: "server",
      threadRef,
    };
  }

  if (!isCanonicalRouteId(params.draftId, DRAFT_ROUTE_ID_MAX_LENGTH)) {
    return null;
  }

  return {
    kind: "draft",
    draftId: params.draftId as DraftId,
  };
}

/**
 * Resolves the thread represented by either a canonical thread route or a
 * draft route whose promotion to a server thread has been recorded.
 */
export function resolveActiveThreadRouteRef(
  target: ThreadRouteTarget | null,
  draftThread: DraftThreadRouteState | null,
): ScopedThreadRef | null {
  if (target?.kind === "server") {
    return target.threadRef;
  }
  if (target?.kind !== "draft" || !draftThread?.promotedTo) {
    return null;
  }
  return draftThread.promotedTo;
}
