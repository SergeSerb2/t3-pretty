import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

export interface TerminalGridSize {
  readonly cols: number;
  readonly rows: number;
}

export interface TerminalUiStateTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
}

const terminalGridSizeCache = new Map<string, TerminalGridSize>();

function terminalUiStateKey(target: TerminalUiStateTarget): string {
  return `${target.environmentId}:${target.threadId}:${target.terminalId}`;
}

export function getCachedTerminalGridSize(target: TerminalUiStateTarget): TerminalGridSize | null {
  const key = terminalUiStateKey(target);
  const cached = terminalGridSizeCache.get(key) ?? null;
  if (cached !== null) {
    terminalGridSizeCache.delete(key);
    terminalGridSizeCache.set(key, cached);
  }
  return cached;
}

export function cacheTerminalGridSize(
  target: TerminalUiStateTarget,
  size: TerminalGridSize,
): TerminalGridSize {
  const normalized = {
    cols: Math.max(1, Math.floor(size.cols)),
    rows: Math.max(1, Math.floor(size.rows)),
  };
  const key = terminalUiStateKey(target);
  terminalGridSizeCache.delete(key);
  terminalGridSizeCache.set(key, normalized);
  while (terminalGridSizeCache.size > MAX_TERMINAL_GRID_SIZE_CACHE_ENTRIES) {
    const oldestKey = terminalGridSizeCache.keys().next().value;
    if (oldestKey === undefined) break;
    terminalGridSizeCache.delete(oldestKey);
  }
  return normalized;
}

export function resetTerminalUiStateCaches() {
  terminalGridSizeCache.clear();
}
