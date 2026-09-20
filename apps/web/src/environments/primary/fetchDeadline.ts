export const PRIMARY_ENVIRONMENT_FETCH_TIMEOUT_MS = 15_000;

type FetchImplementation = typeof globalThis.fetch;

function requestSignal(input: RequestInfo | URL, init?: RequestInit): AbortSignal | null {
  if (init?.signal) return init.signal;
  return typeof Request !== "undefined" && input instanceof Request ? input.signal : null;
}

/**
 * Keeps one deadline signal alive after response headers arrive so a stalled
 * response body is bounded too. The timer self-cleans at the deadline; an
 * upstream Effect cancellation aborts it immediately.
 */
export function fetchPrimaryEnvironmentWithDeadline(
  fetchImplementation: FetchImplementation,
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = PRIMARY_ENVIRONMENT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = requestSignal(input, init);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  };
  const abortFromUpstream = () => {
    cleanup();
    controller.abort(upstreamSignal?.reason);
  };

  if (upstreamSignal?.aborted) {
    controller.abort(upstreamSignal.reason);
  } else {
    upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
    timeoutId = setTimeout(
      () => {
        cleanup();
        controller.abort(
          new DOMException("Primary environment request timed out.", "TimeoutError"),
        );
      },
      Math.max(1, timeoutMs),
    );
  }

  try {
    return fetchImplementation(input, { ...init, signal: controller.signal }).catch((cause) => {
      cleanup();
      throw cause;
    });
  } catch (cause) {
    cleanup();
    throw cause;
  }
}
