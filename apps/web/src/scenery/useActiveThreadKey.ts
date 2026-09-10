/**
 * The scoped thread key (`<environmentId>:<threadId>`) for the thread the
 * user is looking at, derived from the URL so the scenery host can live at
 * the root of the app (outside the thread routes).
 *
 * Draft routes resolve through the draft session, which already carries the
 * final thread id before promotion — keying on `environmentId:threadId`
 * keeps the photo stable across the draft→server URL swap.
 */
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ENTITY_ID_MAX_LENGTH } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";

import { useComposerDraftStore } from "../composerDraftStore";
import {
  DRAFT_ROUTE_ID_MAX_LENGTH,
  resolveThreadRouteRef,
  resolveThreadRouteTarget,
  type ThreadRouteTarget,
} from "../threadRoutes";

/** First path segments that are app routes, not environment ids. */
const NON_THREAD_SEGMENTS = new Set(["draft", "settings", "usage", "connect", "pair"]);
const MAX_ENCODED_ENTITY_ID_LENGTH = ENTITY_ID_MAX_LENGTH * 6;
const MAX_ENCODED_DRAFT_ID_LENGTH = DRAFT_ROUTE_ID_MAX_LENGTH * 6;
const MAX_ACTIVE_THREAD_PATHNAME_LENGTH = "/draft//".length + MAX_ENCODED_DRAFT_ID_LENGTH;

function decodeRouteSegment(raw: string, maximumEncodedLength: number): string | null {
  if (raw.length === 0 || raw.length > maximumEncodedLength) {
    return null;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Parse the root-level URL without letting malformed external paths crash the scenery host. */
export function resolveActiveThreadPathname(pathname: string): ThreadRouteTarget | null {
  if (pathname.length === 0 || pathname.length > MAX_ACTIVE_THREAD_PATHNAME_LENGTH) {
    return null;
  }

  const rawDraftId = /^\/draft\/([^/]+)\/?$/.exec(pathname)?.[1] ?? null;
  if (rawDraftId) {
    const draftId = decodeRouteSegment(rawDraftId, MAX_ENCODED_DRAFT_ID_LENGTH);
    return draftId ? resolveThreadRouteTarget({ draftId }) : null;
  }

  const match = /^\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const environmentId = decodeRouteSegment(match[1], MAX_ENCODED_ENTITY_ID_LENGTH);
  const threadId = decodeRouteSegment(match[2], MAX_ENCODED_ENTITY_ID_LENGTH);
  if (!environmentId || !threadId || NON_THREAD_SEGMENTS.has(environmentId)) {
    return null;
  }

  const threadRef = resolveThreadRouteRef({ environmentId, threadId });
  return threadRef ? { kind: "server", threadRef } : null;
}

export function useActiveThreadKey(): string | null {
  const pathname = useLocation({ select: (location) => location.pathname });
  const target = resolveActiveThreadPathname(pathname);
  const draftId = target?.kind === "draft" ? target.draftId : null;
  const draftSession = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : null,
  );

  if (draftSession) {
    return scopedThreadKey(scopeThreadRef(draftSession.environmentId, draftSession.threadId));
  }

  if (target?.kind === "server") {
    return scopedThreadKey(target.threadRef);
  }

  return null;
}
