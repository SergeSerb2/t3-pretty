import { CommandId, EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const QueuedThreadLifecycleCommand = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("thread.settle"),
    commandId: CommandId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.unsettle"),
    commandId: CommandId,
    threadId: ThreadId,
    reason: Schema.Literal("user"),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.snooze"),
    commandId: CommandId,
    threadId: ThreadId,
    snoozedUntil: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.unsnooze"),
    commandId: CommandId,
    threadId: ThreadId,
    reason: Schema.Literal("user"),
  }),
]);
export type QueuedThreadLifecycleCommand = typeof QueuedThreadLifecycleCommand.Type;

export const PendingThreadLifecycleEntry = Schema.Struct({
  environmentId: EnvironmentId,
  queuedAt: Schema.String,
  command: QueuedThreadLifecycleCommand,
});
export type PendingThreadLifecycleEntry = typeof PendingThreadLifecycleEntry.Type;

export const PendingThreadLifecycleEntries = Schema.Array(PendingThreadLifecycleEntry);
export type PendingThreadLifecycleEntries = typeof PendingThreadLifecycleEntries.Type;

export type ThreadLifecyclePendingByEnvironment = ReadonlyMap<
  EnvironmentId,
  ReadonlyArray<PendingThreadLifecycleEntry>
>;

export const EMPTY_THREAD_LIFECYCLE_PENDING: ThreadLifecyclePendingByEnvironment = new Map();

export type ThreadLifecycleDomain = "settle" | "snooze";

export function threadLifecycleDomain(
  type: QueuedThreadLifecycleCommand["type"],
): ThreadLifecycleDomain {
  return type === "thread.settle" || type === "thread.unsettle" ? "settle" : "snooze";
}
