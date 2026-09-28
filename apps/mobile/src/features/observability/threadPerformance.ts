import * as Effect from "effect/Effect";
import { withRelayClientTracing } from "@t3tools/shared/relayTracing";

import { runtime } from "../../lib/runtime";
import { createKeyedPerformanceSampleGate } from "./performanceSampling";

type SpanAttribute = string | number | boolean;

const threadOpenMarks = new Map<string, number>();
const MAX_PENDING_THREAD_OPEN_MARKS = 64;
const shouldSampleThreadFeedBuild = createKeyedPerformanceSampleGate({ windowMs: 2_000 });

function key(environmentId: string, threadId: string): string {
  return `${environmentId}:${threadId}`;
}

export function markThreadOpenStarted(environmentId: string, threadId: string): void {
  const markKey = key(environmentId, threadId);
  threadOpenMarks.delete(markKey);
  threadOpenMarks.set(markKey, performance.now());
  while (threadOpenMarks.size > MAX_PENDING_THREAD_OPEN_MARKS) {
    const oldestKey = threadOpenMarks.keys().next().value;
    if (oldestKey === undefined) break;
    threadOpenMarks.delete(oldestKey);
  }
}

export function takeThreadOpenDuration(environmentId: string, threadId: string): number | null {
  const markKey = key(environmentId, threadId);
  const startedAt = threadOpenMarks.get(markKey);
  threadOpenMarks.delete(markKey);
  return startedAt === undefined ? null : performance.now() - startedAt;
}

export function recordThreadPerformanceSpan(
  name: string,
  attributes: Readonly<Record<string, SpanAttribute>>,
): void {
  void runtime
    .runPromise(
      Effect.annotateCurrentSpan(attributes).pipe(Effect.withSpan(name), withRelayClientTracing),
    )
    .catch(() => undefined);
}

export function recordThreadFeedBuildPerformanceSpan(
  environmentId: string,
  threadId: string,
  attributes: Readonly<Record<string, SpanAttribute>>,
): void {
  if (!shouldSampleThreadFeedBuild(key(environmentId, threadId))) return;
  recordThreadPerformanceSpan("mobile.thread.feed.build", attributes);
}
