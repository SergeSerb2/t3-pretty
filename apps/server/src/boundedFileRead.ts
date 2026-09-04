import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

const READ_CHUNK_BYTES = 64 * 1024;

export class FileSizeLimitExceededError extends Data.TaggedError("FileSizeLimitExceededError")<{
  readonly filePath: string;
  readonly maximumBytes: number;
}> {}

/** Read at most `maximumBytes` without materializing the rest of the file. */
export const readFilePrefix = Effect.fn("BoundedFileRead.readFilePrefix")(function* (
  fileSystem: FileSystem.FileSystem,
  filePath: string,
  maximumBytes: number,
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* fileSystem.open(filePath, { flag: "r" });
      const info = yield* handle.stat;
      const requestedBytes = BigInt(maximumBytes);
      const initialBytesToRead = Number(info.size < requestedBytes ? info.size : requestedBytes);
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      if (initialBytesToRead > 0) {
        const initial = new Uint8Array(initialBytesToRead);
        while (totalBytes < initial.length) {
          const bytesRead = Number(yield* handle.read(initial.subarray(totalBytes)));
          if (bytesRead === 0) break;
          totalBytes += bytesRead;
        }
        chunks.push(totalBytes === initial.length ? initial : initial.slice(0, totalBytes));
        if (totalBytes < initial.length) return chunks[0]!;
      }

      // The opened file may grow after stat. Continue from the same handle up to the byte
      // ceiling so a complete-file caller cannot mistake a concurrently appended prefix for
      // the whole document.
      while (totalBytes < maximumBytes) {
        const chunk = yield* handle.readAlloc(
          Math.min(READ_CHUNK_BYTES, maximumBytes - totalBytes),
        );
        if (Option.isNone(chunk)) break;
        chunks.push(chunk.value);
        totalBytes += chunk.value.byteLength;
      }

      if (chunks.length === 0) return new Uint8Array();
      if (chunks.length === 1) return chunks[0]!;
      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    }),
  );
});

export const readTextPrefix = Effect.fn("BoundedFileRead.readTextPrefix")(function* (
  fileSystem: FileSystem.FileSystem,
  filePath: string,
  maximumBytes: number,
) {
  const bytes = yield* readFilePrefix(fileSystem, filePath, maximumBytes);
  return new TextDecoder().decode(bytes);
});

/** Read a complete text file only when it fits the byte budget. */
export const readTextWithinLimit = Effect.fn("BoundedFileRead.readTextWithinLimit")(function* (
  fileSystem: FileSystem.FileSystem,
  filePath: string,
  maximumBytes: number,
) {
  const bytes = yield* readFilePrefix(fileSystem, filePath, maximumBytes + 1);
  if (bytes.byteLength > maximumBytes) {
    return yield* new FileSizeLimitExceededError({ filePath, maximumBytes });
  }
  return new TextDecoder().decode(bytes);
});
