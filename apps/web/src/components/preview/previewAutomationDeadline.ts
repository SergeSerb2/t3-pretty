export type PreviewAutomationDeadlineSettlement<T> =
  | { readonly _tag: "Settled"; readonly value: T }
  | { readonly _tag: "Deadline" };

/**
 * Bounds renderer/main-process calls that may otherwise keep a preview request
 * resident forever. The underlying IPC cannot be cancelled, but Promise.race
 * keeps a late settlement detached from the request that already timed out.
 */
export async function settlePreviewAutomationBeforeDeadline<T>(
  promise: Promise<T>,
  remainingMs: number,
): Promise<PreviewAutomationDeadlineSettlement<T>> {
  if (remainingMs <= 0) return { _tag: "Deadline" };
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ _tag: "Settled", value }) as const),
      new Promise<{ readonly _tag: "Deadline" }>((resolve) => {
        timeoutId = window.setTimeout(() => resolve({ _tag: "Deadline" }), remainingMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}
