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
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useLocation } from "@tanstack/react-router";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";

/** First path segments that are app routes, not environment ids. */
const NON_THREAD_SEGMENTS = new Set(["draft", "settings", "usage", "connect", "pair"]);

export function useActiveThreadKey(): string | null {
  const pathname = useLocation({ select: (location) => location.pathname });
  const rawDraftId = /^\/draft\/([^/]+)\/?$/.exec(pathname)?.[1] ?? null;
  // Decode like the router decodes params: legacy migrated draft sessions are
  // keyed `environmentId:threadId`, and the `:` arrives as `%3A`.
  const draftId = (rawDraftId ? decodeURIComponent(rawDraftId) : null) as DraftId | null;
  const draftSession = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : null,
  );

  if (draftSession) {
    return scopedThreadKey(scopeThreadRef(draftSession.environmentId, draftSession.threadId));
  }

  const match = /^\/([^/]+)\/([^/]+)\/?$/.exec(pathname);
  if (match && match[1] && match[2] && !NON_THREAD_SEGMENTS.has(match[1])) {
    return scopedThreadKey(
      scopeThreadRef(match[1] as EnvironmentId, decodeURIComponent(match[2]) as ThreadId),
    );
  }

  return null;
}
