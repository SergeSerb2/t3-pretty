import type {
  EnvironmentId,
  TerminalAttachStreamEvent,
  TerminalMetadataStreamEvent,
  TerminalSessionSnapshot,
  TerminalSummary,
  ThreadId,
} from "@t3tools/contracts";

import { compareIsoDateTimes } from "./threadSort.ts";

export interface TerminalSessionState {
  readonly summary: TerminalSummary | null;
  readonly buffer: string;
  /** Absolute UTF-16 offsets for the retained window within this buffer generation. */
  readonly bufferStartOffset: number;
  readonly bufferEndOffset: number;
  readonly bufferGeneration: number;
  readonly status: TerminalSessionSnapshot["status"] | "closed";
  readonly error: string | null;
  readonly hasRunningSubprocess: boolean;
  readonly updatedAt: string | null;
  readonly version: number;
}

export interface TerminalBufferState {
  readonly buffer: string;
  /** UTF-8 byte length of `buffer`, tracked alongside it so output appends stay O(chunk). */
  readonly bufferByteLength: number;
  /** Absolute UTF-16 offsets for the retained window within this buffer generation. */
  readonly bufferStartOffset: number;
  readonly bufferEndOffset: number;
  readonly bufferGeneration: number;
  readonly status: TerminalSessionSnapshot["status"] | "closed";
  readonly error: string | null;
  readonly updatedAt: string | null;
  readonly version: number;
}

export interface KnownTerminalSessionTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly terminalId: string;
}

export interface KnownTerminalSession {
  readonly target: KnownTerminalSessionTarget;
  readonly state: TerminalSessionState;
}

export function selectRunningSubprocessTerminalIds(
  sessions: ReadonlyArray<KnownTerminalSession>,
): ReadonlyArray<string> {
  return sessions
    .filter((session) => session.state.hasRunningSubprocess)
    .map((session) => session.target.terminalId);
}

export const EMPTY_TERMINAL_BUFFER_STATE = Object.freeze<TerminalBufferState>({
  buffer: "",
  bufferByteLength: 0,
  bufferStartOffset: 0,
  bufferEndOffset: 0,
  bufferGeneration: 0,
  status: "closed",
  error: null,
  updatedAt: null,
  version: 0,
});

export const EMPTY_TERMINAL_SESSION_STATE = Object.freeze<TerminalSessionState>({
  summary: null,
  buffer: "",
  bufferStartOffset: 0,
  bufferEndOffset: 0,
  bufferGeneration: 0,
  status: "closed",
  error: null,
  hasRunningSubprocess: false,
  updatedAt: null,
  version: 0,
});

export const DEFAULT_MAX_TERMINAL_BUFFER_BYTES = 512 * 1024;

interface TrimmedBuffer {
  readonly buffer: string;
  /** Exact UTF-8 byte length of `buffer`; the trim boundary is always code-point aligned. */
  readonly byteLength: number;
}

function utf8CodePointSizeAt(
  value: string,
  index: number,
): {
  readonly codeUnits: number;
  readonly byteLength: number;
} {
  const first = value.charCodeAt(index);
  if (first <= 0x7f) return { codeUnits: 1, byteLength: 1 };
  if (first <= 0x7ff) return { codeUnits: 1, byteLength: 2 };
  if (first >= 0xd800 && first <= 0xdbff) {
    const second = value.charCodeAt(index + 1);
    if (second >= 0xdc00 && second <= 0xdfff) {
      return { codeUnits: 2, byteLength: 4 };
    }
  }
  // TextEncoder replaces an unpaired surrogate with U+FFFD, which is three
  // bytes, just like every other BMP code point above U+07FF.
  return { codeUnits: 1, byteLength: 3 };
}

function utf8ByteLength(value: string): number {
  let byteLength = 0;
  for (let index = 0; index < value.length; ) {
    const next = utf8CodePointSizeAt(value, index);
    index += next.codeUnits;
    byteLength += next.byteLength;
  }
  return byteLength;
}

function trimKnownBufferToBytes(
  buffer: string,
  byteLength: number,
  maxBufferBytes: number,
): TrimmedBuffer {
  if (maxBufferBytes <= 0) {
    return { buffer: "", byteLength: 0 };
  }
  if (byteLength <= maxBufferBytes) {
    return { buffer, byteLength };
  }

  const minimumBytesToDrop = byteLength - maxBufferBytes;
  let start = 0;
  let droppedByteLength = 0;
  while (start < buffer.length && droppedByteLength < minimumBytesToDrop) {
    const next = utf8CodePointSizeAt(buffer, start);
    start += next.codeUnits;
    droppedByteLength += next.byteLength;
  }

  return {
    buffer: buffer.slice(start),
    byteLength: byteLength - droppedByteLength,
  };
}

function trimBufferToBytes(buffer: string, maxBufferBytes: number): TrimmedBuffer {
  return trimKnownBufferToBytes(buffer, utf8ByteLength(buffer), maxBufferBytes);
}

function joinsSurrogatePair(left: string, right: string): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const high = left.charCodeAt(left.length - 1);
  const low = right.charCodeAt(0);
  return high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff;
}

export function terminalBufferStateFromSnapshot(
  snapshot: TerminalSessionSnapshot,
  maxBufferBytes: number,
  bufferGeneration = 1,
): TerminalBufferState {
  const trimmed = trimBufferToBytes(snapshot.history, maxBufferBytes);
  const bufferEndOffset = snapshot.history.length;
  return {
    buffer: trimmed.buffer,
    bufferByteLength: trimmed.byteLength,
    bufferStartOffset: bufferEndOffset - trimmed.buffer.length,
    bufferEndOffset,
    bufferGeneration,
    status: snapshot.status,
    error: null,
    updatedAt: snapshot.updatedAt,
    version: 1,
  };
}

function latestTimestamp(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return compareIsoDateTimes(left, right) >= 0 ? left : right;
}

export function combineTerminalSessionState(
  summary: TerminalSummary | null,
  buffer: TerminalBufferState,
): TerminalSessionState {
  return {
    summary,
    buffer: buffer.buffer,
    bufferStartOffset: buffer.bufferStartOffset,
    bufferEndOffset: buffer.bufferEndOffset,
    bufferGeneration: buffer.bufferGeneration,
    status: buffer.version > 0 ? buffer.status : (summary?.status ?? buffer.status),
    error: buffer.error,
    hasRunningSubprocess: summary?.hasRunningSubprocess ?? false,
    updatedAt: latestTimestamp(summary?.updatedAt ?? null, buffer.updatedAt),
    version: buffer.version,
  };
}

export function applyTerminalAttachStreamEvent(
  current: TerminalBufferState,
  event: TerminalAttachStreamEvent,
  maxBufferBytes = DEFAULT_MAX_TERMINAL_BUFFER_BYTES,
): TerminalBufferState {
  switch (event.type) {
    case "snapshot":
    case "restarted":
      return terminalBufferStateFromSnapshot(
        event.snapshot,
        maxBufferBytes,
        current.bufferGeneration + 1,
      );
    case "output": {
      const chunkByteLength = utf8ByteLength(event.data);
      const bufferEndOffset = current.bufferEndOffset + event.data.length;
      const combinedBuffer = `${current.buffer}${event.data}`;
      // Separately encoded chunks count a surrogate split at the append
      // boundary as two replacement characters (six bytes); once joined it is
      // one four-byte code point.
      const combinedByteLength =
        current.bufferByteLength +
        chunkByteLength -
        (joinsSurrogatePair(current.buffer, event.data) ? 2 : 0);
      // Once full, scan only the prefix that must be evicted instead of
      // re-encoding the complete 512-KiB retained window for every tiny chunk.
      const next = trimKnownBufferToBytes(combinedBuffer, combinedByteLength, maxBufferBytes);
      return {
        ...current,
        buffer: next.buffer,
        bufferByteLength: next.byteLength,
        bufferStartOffset: bufferEndOffset - next.buffer.length,
        bufferEndOffset,
        status: current.status === "closed" ? "running" : current.status,
        error: null,
        version: current.version + 1,
      };
    }
    case "cleared":
      return {
        ...current,
        buffer: "",
        bufferByteLength: 0,
        bufferStartOffset: 0,
        bufferEndOffset: 0,
        bufferGeneration: current.bufferGeneration + 1,
        error: null,
        version: current.version + 1,
      };
    case "exited":
      return {
        ...current,
        status: "exited",
        error: null,
        version: current.version + 1,
      };
    case "closed":
      return {
        ...current,
        status: "closed",
        error: null,
        version: current.version + 1,
      };
    case "error":
      return {
        ...current,
        status: "error",
        error: event.message,
        version: current.version + 1,
      };
    case "activity":
      return current;
  }
}

type TerminalBufferWindow = Pick<
  TerminalSessionState,
  "buffer" | "bufferStartOffset" | "bufferEndOffset" | "bufferGeneration"
>;

/**
 * Returns only output added after `previous`, or null when the terminal must
 * reset because the retained window rolled past it or the stream restarted.
 */
export function terminalBufferAppendSince(
  previous: TerminalBufferWindow,
  current: TerminalBufferWindow,
): string | null {
  if (
    current.bufferGeneration !== previous.bufferGeneration ||
    previous.bufferEndOffset < current.bufferStartOffset ||
    previous.bufferEndOffset > current.bufferEndOffset
  ) {
    return null;
  }
  return current.buffer.slice(previous.bufferEndOffset - current.bufferStartOffset);
}

export function applyTerminalMetadataStreamEvent(
  current: ReadonlyArray<TerminalSummary>,
  event: TerminalMetadataStreamEvent,
): ReadonlyArray<TerminalSummary> {
  if (event.type === "snapshot") {
    return event.terminals;
  }
  if (event.type === "remove") {
    return current.filter(
      (terminal) =>
        terminal.threadId !== event.threadId || terminal.terminalId !== event.terminalId,
    );
  }
  const next = current.filter(
    (terminal) =>
      terminal.threadId !== event.terminal.threadId ||
      terminal.terminalId !== event.terminal.terminalId,
  );
  return [...next, event.terminal];
}
