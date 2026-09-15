import { CommandId, EnvironmentId, IsoDateTime, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export const THREAD_LIFECYCLE_OUTBOX_MAX_ENTRIES = 65_536;
export const THREAD_LIFECYCLE_OUTBOX_MAX_JSON_LENGTH = 16 * 1024 * 1024;

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
    snoozedUntil: IsoDateTime,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.unsnooze"),
    commandId: CommandId,
    threadId: ThreadId,
    reason: Schema.Literal("user"),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.pin"),
    commandId: CommandId,
    threadId: ThreadId,
    orderKey: Schema.optional(Schema.String),
  }),
  Schema.Struct({
    type: Schema.Literal("thread.unpin"),
    commandId: CommandId,
    threadId: ThreadId,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.pin.reorder"),
    commandId: CommandId,
    threadId: ThreadId,
    orderKey: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("thread.active.reorder"),
    commandId: CommandId,
    threadId: ThreadId,
    orderKey: Schema.String,
  }),
]);
export type QueuedThreadLifecycleCommand = typeof QueuedThreadLifecycleCommand.Type;

export const PendingThreadLifecycleEntry = Schema.Struct({
  environmentId: EnvironmentId,
  queuedAt: IsoDateTime,
  command: QueuedThreadLifecycleCommand,
});
export type PendingThreadLifecycleEntry = typeof PendingThreadLifecycleEntry.Type;

export const PendingThreadLifecycleEntries = Schema.Array(PendingThreadLifecycleEntry).check(
  Schema.isMaxLength(THREAD_LIFECYCLE_OUTBOX_MAX_ENTRIES),
);
export type PendingThreadLifecycleEntries = typeof PendingThreadLifecycleEntries.Type;

export type ThreadLifecyclePendingByEnvironment = ReadonlyMap<
  EnvironmentId,
  ReadonlyArray<PendingThreadLifecycleEntry>
>;

export const EMPTY_THREAD_LIFECYCLE_PENDING: ThreadLifecyclePendingByEnvironment = new Map();

export type ThreadLifecycleDomain = "settle" | "snooze" | "pin" | "pin-order" | "active-order";

const DOMAIN_BITS: Record<ThreadLifecycleDomain, number> = {
  settle: 1,
  snooze: 2,
  pin: 4,
  "pin-order": 8,
  "active-order": 16,
};

export function threadLifecycleDomainBit(domain: ThreadLifecycleDomain): number {
  return DOMAIN_BITS[domain];
}

export function threadLifecycleDomain(
  type: QueuedThreadLifecycleCommand["type"],
): ThreadLifecycleDomain {
  switch (type) {
    case "thread.settle":
    case "thread.unsettle":
      return "settle";
    case "thread.snooze":
    case "thread.unsnooze":
      return "snooze";
    case "thread.pin":
    case "thread.unpin":
      return "pin";
    case "thread.pin.reorder":
      return "pin-order";
    case "thread.active.reorder":
      return "active-order";
  }
}
