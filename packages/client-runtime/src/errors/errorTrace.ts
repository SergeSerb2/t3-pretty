import * as Cause from "effect/Cause";

const MAX_ERROR_TRACE_NODES = 128;
const MAX_ERROR_TRACE_ID_LENGTH = 128;

function readProperty(record: object, key: PropertyKey): unknown {
  try {
    return Reflect.get(record, key);
  } catch {
    return undefined;
  }
}

function isEffectCause(value: object): value is Cause.Cause<unknown> {
  try {
    return Cause.isCause(value);
  } catch {
    return false;
  }
}

export function findErrorTraceId(error: unknown): string | null {
  const seen = new Set<object>();
  const pending: Array<unknown> = [error];
  let inspectedNodeCount = 0;

  const enqueue = (value: unknown): void => {
    if (pending.length + inspectedNodeCount < MAX_ERROR_TRACE_NODES) {
      pending.push(value);
    }
  };

  while (pending.length > 0 && inspectedNodeCount < MAX_ERROR_TRACE_NODES) {
    const current = pending.pop();
    inspectedNodeCount += 1;
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);
    const traceId = readProperty(current, "traceId");
    if (typeof traceId === "string") {
      const trimmed = traceId.trim();
      if (trimmed.length > 0 && trimmed.length <= MAX_ERROR_TRACE_ID_LENGTH) {
        return trimmed;
      }
    }

    const cause = readProperty(current, "cause");
    const branchNodeLimit = MAX_ERROR_TRACE_NODES - (cause === undefined ? 0 : 1);
    const enqueueBranch = (value: unknown): void => {
      if (pending.length + inspectedNodeCount < branchNodeLimit) {
        pending.push(value);
      }
    };
    const errors = readProperty(current, "errors");
    if (Array.isArray(errors)) {
      const retained = Math.min(errors.length, branchNodeLimit - inspectedNodeCount);
      for (let index = retained - 1; index >= 0; index -= 1) {
        enqueueBranch(readProperty(errors, index));
      }
    }
    if (isEffectCause(current)) {
      const reasons = readProperty(current, "reasons");
      const retained = Array.isArray(reasons)
        ? Math.min(reasons.length, MAX_ERROR_TRACE_NODES - inspectedNodeCount)
        : 0;
      for (let index = retained - 1; index >= 0; index -= 1) {
        const reason = readProperty(reasons as Array<unknown>, index);
        if (typeof reason !== "object" || reason === null) {
          continue;
        }
        const tag = readProperty(reason, "_tag");
        switch (tag) {
          case "Fail":
            enqueueBranch(readProperty(reason, "error"));
            break;
          case "Die":
            enqueueBranch(readProperty(reason, "defect"));
            break;
        }
      }
    }
    if (cause !== undefined) {
      enqueue(cause);
    }
  }

  return null;
}
