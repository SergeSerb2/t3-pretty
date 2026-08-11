"use client";

import { useAtomValue } from "@effect/atom-react";
import { parseScopedThreadKey, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { CanvasDocument, ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useEffect } from "react";

import { selectRenderedDoc, selectThreadCanvasState, useCanvasStore } from "~/canvasStore";
import { toastManager } from "~/components/ui/toast";
import { canvasEnvironment } from "~/state/canvas";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

class CanvasDocThreadKeyParseError extends Schema.TaggedErrorClass<CanvasDocThreadKeyParseError>()(
  "CanvasDocThreadKeyParseError",
  { threadKey: Schema.String },
) {
  override get message(): string {
    return `Invalid scoped canvas thread key: ${this.threadKey}`;
  }
}

const canvasGetAtom = (threadRef: ScopedThreadRef) =>
  canvasEnvironment.get({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  });

/**
 * Streams server canvas state into the canvas store for one thread: the get
 * query seeds/refreshes the authoritative snapshot and the event subscription
 * advances it delta by delta. Cloned from the preview session sync atom.
 */
const canvasDocSyncAtom = Atom.family((threadKey: string) => {
  const threadRef = parseScopedThreadKey(threadKey);
  if (threadRef === null) {
    throw new CanvasDocThreadKeyParseError({ threadKey });
  }

  const snapshotAtom = canvasGetAtom(threadRef);
  const eventsAtom = canvasEnvironment.events({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  });

  return Atom.make((get) => {
    let disposed = false;
    let eventsVersion = 0;

    const adoptSnapshot = (result: Atom.Type<typeof snapshotAtom>) => {
      if (!AsyncResult.isSuccess(result)) return;
      useCanvasStore.getState().resetFromSnapshot(threadRef, {
        document: result.value.document,
        revision: result.value.revision,
        serverEpoch: result.value.serverEpoch,
        selectedNodeIds: result.value.selectedNodeIds,
      });
    };

    const applyLatestEvent = (result: Atom.Type<typeof eventsAtom>) => {
      if (!AsyncResult.isSuccess(result) || result.value.threadId !== threadRef.threadId) return;
      const event = result.value;
      const store = useCanvasStore.getState();
      if (event.type === "snapshot") {
        store.resetFromSnapshot(threadRef, {
          document: event.document,
          revision: event.revision,
          serverEpoch: event.serverEpoch,
          selectedNodeIds: event.selectedNodeIds,
        });
        return;
      }
      const current = selectThreadCanvasState(store.byThreadKey, threadRef);
      if (current.docEpoch !== event.serverEpoch) {
        // No snapshot yet, or the server restarted and reset its revision
        // counter: deltas cannot be applied safely, so refetch instead.
        get.refresh(snapshotAtom);
        return;
      }
      if (event.type === "applied") {
        // Replay of a revision the document already holds.
        if (event.revision <= current.revision) return;
        if (event.revision > current.revision + 1) {
          // Missed at least one delta; converge through a fresh snapshot.
          get.refresh(snapshotAtom);
          return;
        }
        store.applyServerDelta(threadRef, {
          ops: event.ops,
          revision: event.revision,
          origin: event.origin,
        });
        return;
      }
      // "selection": remote presence is not surfaced yet (later workstream).
    };

    get.addFinalizer(() => {
      disposed = true;
    });
    const initialEvent = get.once(eventsAtom);
    get.subscribe(snapshotAtom, (result) => {
      adoptSnapshot(result);
    });
    get.subscribe(eventsAtom, (result) => {
      eventsVersion += 1;
      applyLatestEvent(result);
    });
    queueMicrotask(() => {
      if (disposed) return;
      // The cached snapshot can predate deltas that streamed while the panel
      // was unmounted. Refetch on mount and only then replay the buffered
      // event, mirroring the preview session sync flow.
      get.refresh(snapshotAtom);
      if (eventsVersion === 0) applyLatestEvent(initialEvent);
    });
  }).pipe(Atom.setIdleTTL(1_000), Atom.withLabel(`canvas:doc-sync:${threadKey}`));
});

function isRevisionConflict(failure: unknown): boolean {
  return (
    typeof failure === "object" &&
    failure !== null &&
    (failure as { _tag?: unknown })._tag === "CanvasRevisionConflictError"
  );
}

export interface CanvasDocView {
  /** serverDoc with in-flight and pending local ops replayed on top. */
  readonly doc: CanvasDocument;
  readonly revision: number;
  /** True until the first authoritative snapshot for this thread arrives. */
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

/**
 * Mounts canvas doc sync for a thread and flushes locally committed ops back
 * to the server.
 *
 * The outbox flusher moves pendingOps into a single in-flight apply RPC at a
 * time. A success acks through flightSucceeded; a revision conflict requeues
 * the ops and refetches the snapshot so they replay over the fresh document;
 * any other failure requeues the ops but pauses flushing until the server
 * revision moves, so a rejected op cannot spin the RPC in a tight loop.
 */
export function useCanvasDoc(threadRef: ScopedThreadRef): CanvasDocView {
  useAtomValue(canvasDocSyncAtom(scopedThreadKey(threadRef)));
  const query = useEnvironmentQuery(canvasGetAtom(threadRef));
  const runApply = useAtomCommand(canvasEnvironment.apply, { reportFailure: false });

  const doc = useCanvasStore((state) =>
    selectRenderedDoc(selectThreadCanvasState(state.byThreadKey, threadRef)),
  );
  const revision = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).revision,
  );
  const hasSnapshot = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).serverDoc !== null,
  );
  const hasPendingOps = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).pendingOps.length > 0,
  );
  const hasFlight = useCanvasStore(
    (state) => selectThreadCanvasState(state.byThreadKey, threadRef).inFlightOps !== null,
  );

  const { environmentId, threadId } = threadRef;
  const refresh = query.refresh;

  useEffect(() => {
    if (!hasSnapshot || !hasPendingOps || hasFlight) return;
    const ref: ScopedThreadRef = { environmentId, threadId };
    const flight = useCanvasStore.getState().takeFlight(ref);
    if (flight === null) return;
    // The continuation must settle the store even if the panel unmounts
    // mid-flight; it only touches the store and the atom registry.
    void runApply({
      environmentId,
      input: { threadId, baseRevision: flight.baseRevision, ops: flight.ops },
    }).then((result) => {
      const store = useCanvasStore.getState();
      if (result._tag === "Success") {
        // The ack only records the revision: `serverDoc` advances when the
        // matching applied event arrives (it may already have). Until then the
        // ops stay visible because the rendered doc keeps replaying them.
        store.flightSucceeded(ref, result.value.revision);
        return;
      }
      const failure = squashAtomCommandFailure(result);
      if (isRevisionConflict(failure)) {
        // Ops return to the queue; replay them over the refreshed document.
        store.flightFailed(ref, { conflict: true });
        refresh();
        return;
      }
      // The server refused these ops outright. Requeueing them would block
      // every later edit behind an op it will never accept, so drop the batch
      // and let the rendered doc fall back to the authoritative document.
      const dropped = store.flightFailed(ref, { conflict: false });
      console.warn("[canvas] apply rejected; dropped local ops", failure, dropped);
      toastManager.add({
        type: "error",
        title: "A canvas change could not be saved",
        description: "The change was undone. The canvas is back in sync with the server.",
      });
      refresh();
    });
  }, [environmentId, threadId, hasSnapshot, hasPendingOps, hasFlight, revision, runApply, refresh]);

  return {
    doc,
    revision,
    loading: !hasSnapshot && query.error === null,
    error: query.error,
    refresh,
  };
}
