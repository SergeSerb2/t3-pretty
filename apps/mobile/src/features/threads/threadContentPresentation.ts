import { type EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";

export type ThreadContentPresentation =
  | { readonly kind: "ready" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "unavailable";
      readonly title: string;
      readonly detail: string;
    };

export function threadLoadingPhase(presentation: ThreadContentPresentation): "loading" | null {
  return presentation.kind === "loading" ? "loading" : null;
}

export function projectThreadContentPresentation(input: {
  readonly hasDetail: boolean;
  readonly detailError: string | null;
  readonly detailDeleted: boolean;
  readonly connectionState: EnvironmentConnectionPhase;
  /** Local starting / queued rows that can paint before the server thread exists. */
  readonly hasOptimisticContent?: boolean;
}): ThreadContentPresentation {
  if (input.hasDetail || input.hasOptimisticContent === true) {
    return { kind: "ready" };
  }
  if (input.detailDeleted) {
    return {
      kind: "unavailable",
      title: "Thread unavailable",
      detail: "This thread was deleted or is no longer available.",
    };
  }
  if (input.detailError !== null) {
    return {
      kind: "unavailable",
      title: "Could not load conversation",
      detail: input.detailError,
    };
  }
  if (
    input.connectionState === "connected" ||
    input.connectionState === "connecting" ||
    input.connectionState === "reconnecting"
  ) {
    // Messages will arrive once the (re)connection completes — present as
    // loading; the composer's connection pill reports the connection phase.
    return { kind: "loading" };
  }
  return {
    kind: "unavailable",
    title: "Messages not cached",
    detail: "Reconnect this environment to load the conversation.",
  };
}

/**
 * Cover the feed while messages are fetching, and while LegendList's first
 * end-scroll is still holding rows at opacity 0. Without this, a running
 * turn can leave the scenery visible and the conversation looking empty
 * after "Loading messages..." disappears.
 *
 * Once rows exist and the list has opened its opacity gate, never keep the
 * overlay up — `contentPresentationKind === "loading"` used to win even after
 * the conversation was already on screen.
 */
export function shouldShowThreadFeedLoadingOverlay(input: {
  readonly contentPresentationKind: ThreadContentPresentation["kind"];
  readonly feedLength: number;
  readonly listReady: boolean;
}): boolean {
  if (input.contentPresentationKind === "unavailable") {
    return false;
  }
  if (input.listReady && input.feedLength > 0) {
    return false;
  }
  if (input.contentPresentationKind === "loading") {
    return true;
  }
  return input.feedLength > 0 && !input.listReady;
}

/**
 * Delays mounting a transient loading indicator with a cancellable JS timer.
 * Delaying a native entrance animation can let it start after React removed
 * the indicator, which leaves stale loading copy on screen.
 */
export function scheduleThreadLoadingVisibility(
  requested: boolean,
  delayMs: number,
  setVisible: (visible: boolean) => void,
): (() => void) | undefined {
  if (!requested) {
    setVisible(false);
    return undefined;
  }
  const timer = setTimeout(() => setVisible(true), delayMs);
  return () => clearTimeout(timer);
}

/**
 * LegendList's patched inset-end reveal hold is capped around 40 frames
 * (~700ms). If `onLoad` never fires after that, drop the overlay so a
 * painted conversation is not covered forever.
 */
export const THREAD_FEED_LIST_READY_FALLBACK_MS = 800;
