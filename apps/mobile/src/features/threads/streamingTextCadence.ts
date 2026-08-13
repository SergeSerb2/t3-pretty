export const STREAMING_TEXT_CADENCE_MS = 64;

type TimerHandle = ReturnType<typeof setTimeout>;

interface StreamingTextCadenceOptions {
  readonly intervalMs?: number;
  readonly now?: () => number;
  readonly schedule?: (callback: () => void, delayMs: number) => TimerHandle;
  readonly cancel?: (handle: TimerHandle) => void;
}

/**
 * Keeps the latest transport text while bounding how often an expensive text
 * renderer sees a growing stream. Settled text always bypasses the cadence.
 */
export function createStreamingTextCadence(
  initialText: string,
  onCommit: (text: string) => void,
  options: StreamingTextCadenceOptions = {},
) {
  const intervalMs = options.intervalMs ?? STREAMING_TEXT_CADENCE_MS;
  const now = options.now ?? (() => performance.now());
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = options.cancel ?? clearTimeout;
  let committedText = initialText;
  let latestText = initialText;
  let lastCommittedAt = now();
  let timer: TimerHandle | null = null;

  const cancelPending = () => {
    if (timer === null) return;
    cancel(timer);
    timer = null;
  };

  const commitLatest = () => {
    if (latestText === committedText) return;
    committedText = latestText;
    lastCommittedAt = now();
    onCommit(committedText);
  };

  const push = (text: string, streaming: boolean) => {
    latestText = text;

    if (!streaming) {
      cancelPending();
      commitLatest();
      return;
    }
    if (latestText === committedText || timer !== null) {
      return;
    }

    const remainingMs = intervalMs - (now() - lastCommittedAt);
    if (remainingMs <= 0) {
      commitLatest();
      return;
    }

    timer = schedule(() => {
      timer = null;
      commitLatest();
    }, remainingMs);
  };

  return {
    push,
    dispose: cancelPending,
  };
}
