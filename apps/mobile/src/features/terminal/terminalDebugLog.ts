/**
 * Debug logging for the mobile terminal pipeline. Prefix: `[t3-terminal]`.
 *
 * Enabled when `__DEV__` is true, or set `globalThis.__T3_TERMINAL_DEBUG__ = true` in a JS
 * debugger / Metro console to trace release/TestFlight builds.
 */
export function isTerminalDebugEnabled(): boolean {
  return (
    (typeof __DEV__ !== "undefined" && __DEV__) ||
    (typeof globalThis !== "undefined" &&
      (globalThis as { __T3_TERMINAL_DEBUG__?: boolean }).__T3_TERMINAL_DEBUG__ === true)
  );
}

const TERMINAL_INPUT_DEBUG_MAX_CODE_POINTS = 32;

export function terminalInputDebugDetails(data: string): {
  readonly utf16Length: number;
  readonly codePointPrefix: ReadonlyArray<number>;
  readonly truncated: boolean;
} {
  const codePointPrefix: number[] = [];
  let truncated = false;
  for (const character of data) {
    if (codePointPrefix.length >= TERMINAL_INPUT_DEBUG_MAX_CODE_POINTS) {
      truncated = true;
      break;
    }
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined) codePointPrefix.push(codePoint);
  }
  return {
    utf16Length: data.length,
    codePointPrefix,
    truncated,
  };
}

export function terminalDebugLog(message: string, data?: Record<string, unknown>): void {
  if (!isTerminalDebugEnabled()) {
    return;
  }
  if (data !== undefined) {
    console.log(`[t3-terminal] ${message}`, data);
  } else {
    console.log(`[t3-terminal] ${message}`);
  }
}
