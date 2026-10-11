/** How long an iPhone waits for native layout metrics before painting anyway. */
export const NATIVE_WORKSPACE_COLUMNS_READY_TIMEOUT_MS = 400;

/**
 * The iPhone workspace navigator must not stay `null` while LayoutMetrics is
 * advertised but never publishes. iPad can attach immediately; older clients
 * without the observer use the compact navigator.
 */
export function nativeWorkspaceColumnsAreReady(input: {
  readonly isPad: boolean;
  readonly hasLayoutMetricsPrototype: boolean;
  readonly hasMetrics: boolean;
  readonly timedOut: boolean;
}): boolean {
  if (input.isPad || !input.hasLayoutMetricsPrototype || input.hasMetrics) {
    return true;
  }
  return input.timedOut;
}
