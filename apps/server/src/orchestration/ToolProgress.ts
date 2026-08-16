/**
 * ToolProgressService - in-memory latest progress per in-flight tool call.
 *
 * Providers stream a `tool.updated` activity per progress tick (dozens per
 * call). Persisting each tick made projection growth track ticks instead of
 * tool calls, so ticks now live here: ingestion records the latest activity
 * per (thread, item) under its stable id (`${itemId}:progress`) and publishes
 * it on `stream` as an ephemeral `thread.activity-appended` event that
 * subscribeThread merges into the live tail. The snapshot query splices the
 * same activities into thread detail so a fresh subscriber matches a live one.
 *
 * Persistence is coalesced: `record` reports when a tick is due to be written
 * (at most once per TOOL_PROGRESS_PERSIST_INTERVAL_MS per item), and `flush`
 * hands back still-running items with unpersisted progress at turn end so a
 * restart shows something sensible. Same pattern as ThreadPlanProgressService.
 *
 * @module ToolProgressService
 */
import {
  EventId,
  type OrchestrationEvent,
  type OrchestrationThreadActivity,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

/** Coalesced progress is written at most this often per tool call. */
export const TOOL_PROGRESS_PERSIST_INTERVAL_MS = 3_000;

export function toolProgressActivityId(itemId: string): EventId {
  return EventId.make(`${itemId}:progress`);
}

interface ToolProgressEntry {
  activity: OrchestrationThreadActivity;
  lastPersistedAtMs: number;
  dirty: boolean;
}

export class ToolProgressService extends Context.Service<
  ToolProgressService,
  {
    /**
     * Feed one tick. Publishes it live and returns whether the caller should
     * persist it now (interval elapsed since the last persisted tick).
     */
    readonly record: (input: {
      readonly threadId: ThreadId;
      readonly itemId: string;
      readonly activity: OrchestrationThreadActivity;
      readonly nowMs: number;
    }) => Effect.Effect<boolean>;

    /** Tool finished: its completion row supersedes any progress. */
    readonly complete: (threadId: ThreadId, itemId: string) => void;

    /**
     * Turn settled or session died: returns still-running items whose latest
     * progress was never persisted, then forgets the thread.
     */
    readonly flush: (threadId: ThreadId) => ReadonlyArray<OrchestrationThreadActivity>;

    readonly getThreadProgress: (threadId: ThreadId) => ReadonlyArray<OrchestrationThreadActivity>;

    /** Every recorded tick, as an ephemeral event (`sequence: 0`, never stored). */
    readonly stream: Stream.Stream<OrchestrationEvent>;
  }
>()("t3/orchestration/ToolProgress/ToolProgressService") {}

export const make = Effect.gen(function* () {
  const entriesByThreadId = new Map<ThreadId, Map<string, ToolProgressEntry>>();
  const pubsub = yield* PubSub.unbounded<OrchestrationEvent>();

  const liveEvent = (
    threadId: ThreadId,
    activity: OrchestrationThreadActivity,
  ): OrchestrationEvent => ({
    sequence: 0,
    eventId: EventId.make(`${activity.id}:live`),
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: activity.createdAt,
    commandId: null,
    causationEventId: null,
    correlationId: null,
    metadata: {},
    type: "thread.activity-appended",
    payload: { threadId, activity },
  });

  return {
    record: ({ threadId, itemId, activity, nowMs }) =>
      Effect.gen(function* () {
        let entries = entriesByThreadId.get(threadId);
        if (!entries) {
          entries = new Map();
          entriesByThreadId.set(threadId, entries);
        }
        // The first tick starts the clock rather than persisting: short tools
        // (the majority) then leave only their started/completed rows.
        const entry = entries.get(itemId) ?? { activity, lastPersistedAtMs: nowMs, dirty: false };
        entry.activity = activity;
        entry.dirty = true;
        entries.set(itemId, entry);
        yield* PubSub.publish(pubsub, liveEvent(threadId, activity));
        if (nowMs - entry.lastPersistedAtMs < TOOL_PROGRESS_PERSIST_INTERVAL_MS) {
          return false;
        }
        entry.lastPersistedAtMs = nowMs;
        entry.dirty = false;
        return true;
      }),

    complete: (threadId, itemId) => {
      const entries = entriesByThreadId.get(threadId);
      entries?.delete(itemId);
      if (entries?.size === 0) {
        entriesByThreadId.delete(threadId);
      }
    },

    flush: (threadId) => {
      const entries = entriesByThreadId.get(threadId);
      entriesByThreadId.delete(threadId);
      if (!entries) {
        return [];
      }
      return [...entries.values()].filter((entry) => entry.dirty).map((entry) => entry.activity);
    },

    getThreadProgress: (threadId) =>
      [...(entriesByThreadId.get(threadId)?.values() ?? [])].map((entry) => entry.activity),

    stream: Stream.fromPubSub(pubsub),
  } satisfies ToolProgressService["Service"];
});

export const layer = Layer.effect(ToolProgressService, make);
