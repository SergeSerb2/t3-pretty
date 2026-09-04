import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";

const READ_CHUNK_BYTES = 64 * 1024;

export class DesktopFileSizeLimitExceededError extends Data.TaggedError(
  "DesktopFileSizeLimitExceededError",
)<{
  readonly filePath: string;
  readonly maximumBytes: number;
  readonly actualBytes: bigint;
}> {}

/** Read a complete text file only when its opened handle is within the byte budget. */
export const readFileStringWithinLimit = Effect.fnUntraced(function* (
  fileSystem: FileSystem.FileSystem,
  filePath: string,
  maximumBytes: number,
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* fileSystem.open(filePath, { flag: "r" });
      const info = yield* handle.stat;
      if (info.size > BigInt(maximumBytes)) {
        return yield* new DesktopFileSizeLimitExceededError({
          filePath,
          maximumBytes,
          actualBytes: info.size,
        });
      }

      const initial = new Uint8Array(Number(info.size));
      let totalBytes = 0;
      while (totalBytes < initial.length) {
        const bytesRead = Number(yield* handle.read(initial.subarray(totalBytes)));
        if (bytesRead === 0) break;
        totalBytes += bytesRead;
      }
      if (totalBytes < initial.length) {
        return new TextDecoder().decode(initial.subarray(0, totalBytes));
      }

      const chunks: Uint8Array[] = initial.length === 0 ? [] : [initial];
      const readCeiling = maximumBytes + 1;
      while (totalBytes < readCeiling) {
        const chunk = yield* handle.readAlloc(Math.min(READ_CHUNK_BYTES, readCeiling - totalBytes));
        if (Option.isNone(chunk)) break;
        chunks.push(chunk.value);
        totalBytes += chunk.value.byteLength;
      }
      if (totalBytes > maximumBytes) {
        const latestInfo = yield* handle.stat;
        return yield* new DesktopFileSizeLimitExceededError({
          filePath,
          maximumBytes,
          actualBytes:
            latestInfo.size > BigInt(maximumBytes) ? latestInfo.size : BigInt(totalBytes),
        });
      }

      if (chunks.length === 0) return "";
      if (chunks.length === 1) return new TextDecoder().decode(chunks[0]!);
      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(bytes);
    }),
  );
});
