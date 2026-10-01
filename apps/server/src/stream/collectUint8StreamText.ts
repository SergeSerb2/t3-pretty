import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as NodeBuffer from "node:buffer";

export interface CollectedUint8StreamText {
  readonly text: string;
  readonly truncated: boolean;
  readonly bytes: number;
  readonly invalidUtf8: boolean;
}

export const decodeUtf8 = (
  bytes: Uint8Array,
): Pick<CollectedUint8StreamText, "text" | "invalidUtf8"> => ({
  text: Buffer.from(bytes).toString("utf8"),
  invalidUtf8: !NodeBuffer.isUtf8(bytes),
});

interface CollectState {
  chunks: Uint8Array[];
  readonly bytes: number;
  readonly truncated: boolean;
}

interface BoundedChunk {
  readonly chunk: Uint8Array;
  readonly truncated: boolean;
}

const initialCollectState = (): CollectState => ({
  chunks: [],
  bytes: 0,
  truncated: false,
});

const appendChunk = (maxBytes: number) => (state: CollectState, chunk: Uint8Array) => {
  /*
   * Process output normally drains after truncation so a child process can exit cleanly. HTTP
   * callers can opt out below: once their prefix is collected, interrupting the response stream
   * saves the remaining bandwidth instead of reading and discarding it.
   */
  if (state.truncated) {
    return state;
  }

  const remainingBytes = maxBytes - state.bytes;
  if (remainingBytes <= 0) {
    return {
      ...state,
      truncated: true,
    };
  }

  const nextChunk = chunk.byteLength > remainingBytes ? chunk.slice(0, remainingBytes) : chunk;
  state.chunks.push(nextChunk);
  const bytes = state.bytes + nextChunk.byteLength;
  const truncated = chunk.byteLength > remainingBytes;

  return {
    chunks: state.chunks,
    bytes,
    truncated,
  };
};

export const collectUint8StreamText = <E>(input: {
  readonly stream: Stream.Stream<Uint8Array, E>;
  readonly maxBytes?: number | undefined;
  readonly truncatedMarker?: string | null | undefined;
  /** Keep consuming after the retained prefix is full. Process pipes need this; HTTP does not. */
  readonly drainAfterTruncation?: boolean | undefined;
}): Effect.Effect<CollectedUint8StreamText, E> => {
  const maxBytes = Math.max(0, input.maxBytes ?? Number.POSITIVE_INFINITY);
  const truncatedMarker = input.truncatedMarker ?? "";
  const foldChunk = appendChunk(maxBytes);

  const collect =
    input.drainAfterTruncation === false && Number.isFinite(maxBytes)
      ? input.stream.pipe(
          Stream.mapAccum(
            () => 0,
            (bytes, chunk): readonly [number, ReadonlyArray<BoundedChunk>] => {
              const remainingBytes = maxBytes - bytes;
              const retained =
                remainingBytes <= 0
                  ? new Uint8Array()
                  : chunk.byteLength > remainingBytes
                    ? chunk.slice(0, remainingBytes)
                    : chunk;
              const truncated = chunk.byteLength > remainingBytes;
              return [
                bytes + retained.byteLength,
                [{ chunk: retained, truncated } satisfies BoundedChunk],
              ];
            },
          ),
          Stream.takeUntil((bounded) => bounded.truncated),
          Stream.runFold(initialCollectState, (state, bounded) => {
            const next = foldChunk(state, bounded.chunk);
            return bounded.truncated && !next.truncated ? { ...next, truncated: true } : next;
          }),
        )
      : input.stream.pipe(Stream.runFold(initialCollectState, foldChunk));

  return collect.pipe(
    Effect.map((state): CollectedUint8StreamText => {
      const decoded = decodeUtf8(Buffer.concat(state.chunks, state.bytes));
      return {
        text:
          state.truncated && truncatedMarker.length > 0
            ? `${decoded.text}${truncatedMarker}`
            : decoded.text,
        bytes: state.bytes,
        truncated: state.truncated,
        invalidUtf8: decoded.invalidUtf8,
      };
    }),
  );
};
