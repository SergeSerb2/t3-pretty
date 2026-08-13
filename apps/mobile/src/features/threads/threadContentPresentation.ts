import { type EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";

export type ThreadContentPresentation =
  | { readonly kind: "ready" }
  | { readonly kind: "loading" }
  | {
      readonly kind: "unavailable";
      readonly title: string;
      readonly detail: string;
    };

export function projectThreadContentPresentation(input: {
  readonly hasDetail: boolean;
  readonly detailError: string | null;
  readonly detailDeleted: boolean;
  readonly connectionState: EnvironmentConnectionPhase;
}): ThreadContentPresentation {
  if (input.hasDetail) {
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
 */
export function shouldShowThreadFeedLoadingOverlay(input: {
  readonly contentPresentationKind: ThreadContentPresentation["kind"];
  readonly feedLength: number;
  readonly listReady: boolean;
}): boolean {
  if (input.contentPresentationKind === "unavailable") {
    return false;
  }
  if (input.contentPresentationKind === "loading") {
    return true;
  }
  return input.feedLength > 0 && !input.listReady;
}
