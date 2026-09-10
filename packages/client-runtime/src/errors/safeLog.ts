const SAFE_ERROR_LABEL =
  /^(?:Error|EvalError|RangeError|ReferenceError|SyntaxError|TypeError|URIError|AggregateError|DOMException|[A-Za-z][A-Za-z0-9]*(?:Error|Failure))$/;
const SAFE_TRACE_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const STACK_FRAME_LIMIT = 32;
const STACK_SOURCE_MAX_LENGTH = 64 * 1024;
const TRACE_CAUSE_LIMIT = 128;

export interface SafeErrorLogAttributes {
  readonly errorType: "error" | "array" | "null" | "object" | "primitive";
  readonly errorName?: string;
  readonly errorTag?: string;
  readonly traceId?: string;
  readonly stack?: string;
}

function readSafeLabel(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_ERROR_LABEL.test(value) ? value : undefined;
}

function sanitizeStackUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.replace(/[?#][\s\S]*$/u, "").replace(/^((?:https?|file):\/\/)[^/@\s]*@/iu, "$1");
  }
}

function sanitizeStackFrame(frame: string): string {
  return frame.replace(/(?:https?|file):\/\/[^\s)]+/g, sanitizeStackUrl);
}

function readSafeStack(error: Error): string | undefined {
  try {
    const stack = error.stack;
    if (typeof stack !== "string") {
      return undefined;
    }
    const frames: string[] = [];
    for (const line of stack.slice(0, STACK_SOURCE_MAX_LENGTH).split(/\r?\n/)) {
      if (/^\s*at\s+/.test(line) || /^[^@\s]+@(?:https?|file):\/\//.test(line)) {
        frames.push(sanitizeStackFrame(line));
        if (frames.length >= STACK_FRAME_LIMIT) {
          break;
        }
      }
    }
    return frames.length > 0 ? frames.join("\n") : undefined;
  } catch {
    return undefined;
  }
}

function readErrorTag(error: unknown): string | undefined {
  try {
    if (typeof error !== "object" || error === null) {
      return undefined;
    }
    return readSafeLabel((error as { readonly _tag?: unknown })._tag);
  } catch {
    return undefined;
  }
}

function readTraceId(error: unknown): string | undefined {
  try {
    const seen = new Set<object>();
    let current: unknown = error;
    let visited = 0;

    while (
      typeof current === "object" &&
      current !== null &&
      !seen.has(current) &&
      visited < TRACE_CAUSE_LIMIT
    ) {
      seen.add(current);
      visited += 1;
      const record = current as { readonly cause?: unknown; readonly traceId?: unknown };
      if (typeof record.traceId === "string" && SAFE_TRACE_ID.test(record.traceId)) {
        return record.traceId;
      }
      current = record.cause;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export function safeErrorLogAttributes(error: unknown): SafeErrorLogAttributes {
  const errorTag = readErrorTag(error);
  const traceId = readTraceId(error);

  if (error instanceof Error) {
    const errorName = readSafeLabel(error.name);
    const stack = readSafeStack(error);
    return {
      errorType: "error",
      ...(errorName !== undefined ? { errorName } : {}),
      ...(errorTag !== undefined ? { errorTag } : {}),
      ...(traceId !== undefined ? { traceId } : {}),
      ...(stack !== undefined ? { stack } : {}),
    };
  }

  return {
    errorType:
      error === null
        ? "null"
        : Array.isArray(error)
          ? "array"
          : typeof error === "object"
            ? "object"
            : "primitive",
    ...(errorTag !== undefined ? { errorTag } : {}),
    ...(traceId !== undefined ? { traceId } : {}),
  };
}
