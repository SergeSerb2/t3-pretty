import * as Effect from "effect/Effect";
import { withRelayClientTracing } from "@t3tools/shared/relayTracing";

import { runtime } from "../../lib/runtime";

type SpanAttribute = string | number | boolean;

const threadOpenMarks = new Map<string, number>();

function key(environmentId: string, threadId: string): string {
  return `${environmentId}:${threadId}`;
}

export function markThreadOpenStarted(environmentId: string, threadId: string): void {
  threadOpenMarks.set(key(environmentId, threadId), performance.now());
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
