/**
 * ShellStream - projects orchestration domain events into the sidebar's shell
 * stream once per server and fans the built items out to every subscribed
 * client, so N sockets cost one coalescing window, one set of DB reads and
 * one built object per event instead of N.
 *
 * Message and activity appends only bump a thread's `updatedAt`, so they
 * project to a ~120 B `thread-touched` delta with no DB read; everything else
 * that touches a thread aggregate refetches the shell row (`thread-upserted`
 * / `thread-removed`). Replay for a resuming cursor runs the same projector
 * over the persisted event log, so live and replayed streams agree.
 *
 * @module ShellStream
 */
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationShellStreamEvent,
  type ProjectId,
} from "@t3tools/contracts";

import type { OrchestrationEventStoreError } from "../persistence/Errors.ts";
import { SHELL_SUMMARY_COUNT_ACTIVITY_KINDS } from "./Layers/ProjectionPipeline.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";

/**
 * Activity kinds whose append changes shell fields beyond `updatedAt`:
 * pending approval / user-input flags (the projector's summary refresh), plan
 * progress (ThreadPlanProgress) and background liveness
 * (ThreadBackgroundLiveness). These still refetch.
 */
const SHELL_UPSERT_ACTIVITY_KINDS: ReadonlySet<string> = new Set([
  ...SHELL_SUMMARY_COUNT_ACTIVITY_KINDS,
  "turn.plan.updated",
  "task.started",
  "task.progress",
  "task.updated",
  "task.completed",
]);

/**
 * True when the event's only effect on the thread's shell row is bumping
 * `updatedAt` to `event.occurredAt` (mirrors the projector's write for these
 * events), so the stream can send `thread-touched` instead of refetching.
 */
export function isShellTouchEvent(event: OrchestrationEvent): boolean {
  switch (event.type) {
    case "thread.message-sent":
      // A completed user message also advances latestUserMessageAt, which
      // orders the sidebar.
      return !(event.payload.role === "user" && !event.payload.streaming);
    case "thread.activity-appended":
      return !SHELL_UPSERT_ACTIVITY_KINDS.has(event.payload.activity.kind);
    default:
      return false;
  }
}

// Small time/size window over which to coalesce shell events. The window
// bounds the worst-case added latency for a brand-new thread to appear in
// the sidebar (imperceptible), while collapsing high-frequency streaming
// traffic so it can't serialize the shell stream behind per-event DB reads.
const SHELL_COALESCE_WINDOW = Duration.millis(50);
const SHELL_COALESCE_MAX_CHUNK = 512;
const SHELL_REFETCH_CONCURRENCY = 8;

export const makeShellStreamProjector = (
  projectionSnapshotQuery: ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"],
) => {
  // Retry a typed persistence failure once so a brief read failure cannot
  // strand the shell at its previous state. If both attempts fail, log and
  // drop the stream item; treating an error as a missing row would
  // incorrectly remove a still-active aggregate.
  const retryShellProjectionRead = <A, E>(
    aggregateKind: "project" | "thread",
    aggregateId: string,
    read: Effect.Effect<A, E>,
  ): Effect.Effect<Option.Option<A>, never, never> =>
    read.pipe(
      Effect.retry({ times: 1 }),
      Effect.map(Option.some),
      Effect.tapError((error) =>
        Effect.logWarning("orchestration shell projection refetch failed", {
          aggregateKind,
          aggregateId,
          error,
        }),
      ),
      Effect.orElseSucceed(() => Option.none()),
    );

  const projectUpsertOrRemove = (
    projectId: ProjectId,
    sequence: number,
  ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> =>
    retryShellProjectionRead(
      "project",
      projectId,
      projectionSnapshotQuery.getProjectShellById(projectId),
    ).pipe(
      Effect.map(
        Option.flatMap((project) =>
          Option.match(project, {
            onNone: () =>
              Option.some<OrchestrationShellStreamEvent>({
                kind: "project-removed" as const,
                sequence,
                projectId,
              }),
            onSome: (nextProject) =>
              Option.some<OrchestrationShellStreamEvent>({
                kind: "project-upserted" as const,
                sequence,
                project: nextProject,
              }),
          }),
        ),
      ),
    );

  // Refetch a thread's shell and emit an upsert if it is still active, or a
  // `thread-removed` if the projection has no active row for it. Emitting a
  // removal on a `none` (rather than dropping the event) is what keeps
  // coalescing correct: when a burst collapses a `thread.deleted`/`archived`
  // into a later refetchable event for the same thread, the refetch returns
  // `none` for the now-inactive row and this still tells the sidebar to drop
  // it. A `thread-removed` the client does not have is a harmless no-op. The
  // projection commits in the same transaction before the event publishes,
  // so a `none` reliably means the thread is deleted or archived, not
  // not-yet-persisted.
  const threadUpsertOrRemove = (
    threadId: ThreadId,
    sequence: number,
  ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> =>
    retryShellProjectionRead(
      "thread",
      threadId,
      projectionSnapshotQuery.getThreadShellById(threadId),
    ).pipe(
      Effect.map(
        Option.flatMap((thread) =>
          Option.match(thread, {
            onNone: () =>
              Option.some<OrchestrationShellStreamEvent>({
                kind: "thread-removed" as const,
                sequence,
                threadId,
              }),
            onSome: (nextThread) =>
              Option.some<OrchestrationShellStreamEvent>({
                kind: "thread-upserted" as const,
                sequence,
                thread: nextThread,
              }),
          }),
        ),
      ),
    );

  const toShellStreamEvent = (
    event: OrchestrationEvent,
  ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> => {
    switch (event.type) {
      case "project.created":
      case "project.meta-updated":
        return projectUpsertOrRemove(event.payload.projectId, event.sequence);
      case "project.deleted":
        return Effect.succeed(
          Option.some({
            kind: "project-removed" as const,
            sequence: event.sequence,
            projectId: event.payload.projectId,
          }),
        );
      case "thread.deleted":
      case "thread.archived":
        return Effect.succeed(
          Option.some({
            kind: "thread-removed" as const,
            sequence: event.sequence,
            threadId: event.payload.threadId,
          }),
        );
      case "thread.unarchived":
        return threadUpsertOrRemove(event.payload.threadId, event.sequence);
      default:
        if (event.aggregateKind !== "thread") {
          return Effect.succeed(Option.none());
        }
        return threadUpsertOrRemove(ThreadId.make(event.aggregateId), event.sequence);
    }
  };

  const toShellTouchEvent = (event: OrchestrationEvent): OrchestrationShellStreamEvent => ({
    kind: "thread-touched" as const,
    sequence: event.sequence,
    threadId: ThreadId.make(event.aggregateId),
    updatedAt: event.occurredAt,
  });

  // Turn a batch of domain events into shell stream items, coalescing by
  // aggregate first. A refetch re-reads the *current* projected shell for an
  // aggregate, so within a batch only the latest event per aggregate matters:
  // a burst of streaming `thread.message-sent` deltas for one thread collapses
  // into a single item, and an unrelated `thread.created` in the same batch is
  // never stuck behind those DB reads. A batch that is touch-only for an
  // aggregate emits one `thread-touched` with no read at all; if any event in
  // it needs a refetch, the refetch (at the latest sequence) wins, since the
  // projection already reflects the touches too.
  //
  // Input events arrive in ascending sequence; we keep the last (highest
  // sequence) event per aggregate, then re-sort ascending before emitting so
  // the client — which applies shell items strictly by increasing sequence
  // and drops any `sequence <= snapshotSequence` — never skips a coalesced
  // item. The refetch runs with bounded concurrency (order-preserving).
  const coalesceShellEvents = (
    events: ReadonlyArray<OrchestrationEvent>,
  ): Effect.Effect<ReadonlyArray<OrchestrationShellStreamEvent>, never, never> =>
    Effect.gen(function* () {
      if (events.length === 0) {
        return [];
      }
      const latestByAggregate = new Map<
        string,
        { readonly event: OrchestrationEvent; readonly refetch: boolean }
      >();
      for (const event of events) {
        const key = `${event.aggregateKind}:${event.aggregateId}`;
        const refetch = (latestByAggregate.get(key)?.refetch ?? false) || !isShellTouchEvent(event);
        latestByAggregate.set(key, { event, refetch });
      }
      const survivors = Array.from(latestByAggregate.values()).sort(
        (left, right) => left.event.sequence - right.event.sequence,
      );
      const shellEvents = yield* Effect.forEach(
        survivors,
        ({ event, refetch }) =>
          refetch
            ? toShellStreamEvent(event)
            : Effect.succeed(Option.some(toShellTouchEvent(event))),
        { concurrency: SHELL_REFETCH_CONCURRENCY },
      );
      return shellEvents.flatMap((option) => (Option.isSome(option) ? [option.value] : []));
    });

  const coalesceShellStream = <E, R>(
    stream: Stream.Stream<OrchestrationEvent, E, R>,
  ): Stream.Stream<OrchestrationShellStreamEvent, E, R> =>
    stream.pipe(
      Stream.groupedWithin(SHELL_COALESCE_MAX_CHUNK, SHELL_COALESCE_WINDOW),
      Stream.mapEffect(coalesceShellEvents),
      Stream.flatMap((items) => Stream.fromIterable(items)),
    );

  // For clients that did not opt in to `thread-touched`, refetch the row so
  // they get the same `thread-upserted` / `thread-removed` they always did.
  const expandTouched = (
    item: OrchestrationShellStreamEvent,
  ): Effect.Effect<Option.Option<OrchestrationShellStreamEvent>, never, never> =>
    item.kind === "thread-touched"
      ? threadUpsertOrRemove(item.threadId, item.sequence)
      : Effect.succeed(Option.some(item));

  return { coalesceShellEvents, coalesceShellStream, expandTouched } as const;
};

type ShellRawInput =
  | { readonly _tag: "event"; readonly event: OrchestrationEvent }
  | { readonly _tag: "barrier"; readonly done: Deferred.Deferred<void> };

export class ShellStreamBroadcaster extends Context.Service<
  ShellStreamBroadcaster,
  {
    /**
     * Subscribe to live shell events, already coalesced and projected once
     * for every subscriber. Each element is one coalescing window's batch in
     * ascending sequence order. Subscribe before loading a snapshot so events
     * published while it is in flight are buffered, not lost.
     */
    readonly subscribe: Effect.Effect<
      PubSub.Subscription<ReadonlyArray<OrchestrationShellStreamEvent>>,
      never,
      Scope.Scope
    >;
    /**
     * Resolves once every domain event published before the call has been
     * projected and delivered to all subscriptions, so a subscriber can emit
     * its completion marker after them without waiting out the window when
     * the stream is idle.
     */
    readonly settle: Effect.Effect<void>;
    /**
     * Turn a `thread-touched` into the full `thread-upserted` (or removal) a
     * client that did not opt in to touches expects; other items pass through.
     */
    readonly expandTouched: (
      item: OrchestrationShellStreamEvent,
    ) => Effect.Effect<Option.Option<OrchestrationShellStreamEvent>>;
    /** Replay persisted events after a cursor through the same projector. */
    readonly replay: (
      afterSequence: number,
      limit: number,
    ) => Stream.Stream<OrchestrationShellStreamEvent, OrchestrationEventStoreError, never>;
  }
>()("t3/orchestration/ShellStream/ShellStreamBroadcaster") {}

export const layer = Layer.effect(
  ShellStreamBroadcaster,
  Effect.gen(function* () {
    const orchestrationEngine = yield* OrchestrationEngine.OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    const projector = makeShellStreamProjector(projectionSnapshotQuery);
    // ponytail: unbounded per subscriber, same as the per-socket queue it
    // replaces; a slow socket buffers here instead of in its own queue.
    const pubsub = yield* PubSub.unbounded<ReadonlyArray<OrchestrationShellStreamEvent>>();
    const raw = yield* Queue.unbounded<ShellRawInput>();
    yield* Effect.forkScoped(
      orchestrationEngine.streamDomainEvents.pipe(
        Stream.runForEach((event) => Queue.offer(raw, { _tag: "event", event })),
      ),
      { startImmediately: true },
    );

    const publish = (events: ReadonlyArray<OrchestrationEvent>) =>
      events.length === 0
        ? Effect.void
        : projector
            .coalesceShellEvents(events)
            .pipe(
              Effect.flatMap((batch) =>
                batch.length === 0 ? Effect.void : PubSub.publish(pubsub, batch),
              ),
            );

    // Barriers ride the same queue as events, so completing one means every
    // event queued before it has already been published.
    const flush = (inputs: ReadonlyArray<ShellRawInput>) =>
      Effect.gen(function* () {
        let pending: Array<OrchestrationEvent> = [];
        for (const input of inputs) {
          if (input._tag === "event") {
            pending.push(input.event);
            continue;
          }
          yield* publish(pending);
          pending = [];
          yield* Deferred.succeed(input.done, undefined);
        }
        yield* publish(pending);
      });

    // One coalescing loop for the whole server: the first event opens the
    // window, everything that lands within it is projected as one batch. A
    // barrier arriving on an idle stream is honoured immediately.
    yield* Effect.forkScoped(
      Effect.gen(function* () {
        for (;;) {
          const first = yield* Queue.take(raw);
          if (first._tag === "event") {
            yield* Effect.sleep(SHELL_COALESCE_WINDOW);
          }
          // Queue.takeBetween(q, 0, n) short-circuits to [] on min <= 0; clear
          // drains everything that landed during the window.
          const rest = yield* Queue.clear(raw);
          // One loop serves every socket: a defect in one batch must not end
          // shell streaming for the whole server (or hang every `settle`).
          yield* flush([first, ...rest]).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("orchestration shell stream batch failed", {
                cause: Cause.pretty(cause),
              }),
            ),
          );
        }
      }),
      { startImmediately: true },
    );

    return {
      subscribe: PubSub.subscribe(pubsub),
      settle: Deferred.make<void>().pipe(
        Effect.tap((done) => Queue.offer(raw, { _tag: "barrier", done })),
        Effect.flatMap(Deferred.await),
      ),
      expandTouched: projector.expandTouched,
      replay: (afterSequence, limit) =>
        projector.coalesceShellStream(orchestrationEngine.readEvents(afterSequence, limit)),
    };
  }),
);
