// @effect-diagnostics nodeBuiltinImport:off
/**
 * Raw filesystem access for transcript scanning.
 *
 * Isolated here so the rest of the usage code stays on Effect's `FileSystem`.
 * The direct `node:fs` streaming is deliberate: a cold 30-day window is ~1.4 GB
 * across ~1,500 files, and direct bounded framing over a read stream is roughly
 * an order of magnitude cheaper than materialising each file. The equivalent
 * Effect stream pipeline is idiomatic but not fast enough to sit behind a page
 * load.
 *
 * @module usageTranscriptReader
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { UsageProviderKind } from "@t3tools/contracts";

import {
  initialCodexScanState,
  kimiSessionIdFromPath,
  mightCarryUsage,
  parseClaudeLine,
  parseCodexLine,
  parseGrokLine,
  parseKimiLine,
  type UsageRecord,
} from "./usageTranscripts.ts";

export interface TranscriptFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

export const TRANSCRIPT_FILE_MAX = 50_000;
export const TRANSCRIPT_DIRECTORY_MAX = 20_000;
export const TRANSCRIPT_ENTRY_MAX = 500_000;

export interface TranscriptListing {
  readonly files: readonly TranscriptFile[];
  readonly truncated: boolean;
  readonly unreadableDirectories: number;
}

export interface TranscriptListingLimits {
  readonly maxFiles?: number;
  readonly maxDirectories?: number;
  readonly maxEntries?: number;
}

/**
 * Provider transcripts can contain large tool payloads, but a single malformed
 * JSONL record must not be able to grow the server heap without bound while the
 * Usage page scans it. Oversized records are skipped and scanning resumes at
 * the next newline so one bad record does not hide the rest of the file.
 */
export const TRANSCRIPT_LINE_MAX_BYTES = 16 * 1024 * 1024;
export const TRANSCRIPT_FILE_RECORD_MAX = 200_000;

/**
 * Frames UTF-8 JSONL without retaining more than `maxLineBytes` for one line.
 * Newlines are safe to find byte-wise because `0x0a` cannot occur inside a
 * multi-byte UTF-8 sequence.
 */
export async function* readUtf8LinesWithinLimit(
  input: AsyncIterable<Uint8Array>,
  maxLineBytes = TRANSCRIPT_LINE_MAX_BYTES,
  onOversizedLine: () => void = () => {},
): AsyncGenerator<string> {
  const boundedMax = Number.isFinite(maxLineBytes) ? Math.max(0, Math.trunc(maxLineBytes)) : 0;
  let chunks: Buffer[] = [];
  let retainedBytes = 0;
  let discarding = false;

  const reset = () => {
    chunks = [];
    retainedBytes = 0;
    discarding = false;
  };

  const decodeRetainedLine = () => {
    const line = Buffer.concat(chunks, retainedBytes);
    const content = line.at(-1) === 0x0d ? line.subarray(0, -1) : line;
    return content.toString("utf8");
  };

  for await (const rawChunk of input) {
    const chunk = Buffer.from(rawChunk.buffer, rawChunk.byteOffset, rawChunk.byteLength);
    let offset = 0;

    while (offset < chunk.byteLength) {
      const newline = chunk.indexOf(0x0a, offset);
      const end = newline === -1 ? chunk.byteLength : newline;
      const segment = chunk.subarray(offset, end);

      if (!discarding) {
        if (retainedBytes + segment.byteLength > boundedMax) {
          chunks = [];
          retainedBytes = 0;
          discarding = true;
          onOversizedLine();
        } else if (segment.byteLength > 0) {
          chunks.push(segment);
          retainedBytes += segment.byteLength;
        }
      }

      if (newline === -1) break;
      if (!discarding) yield decodeRetainedLine();
      reset();
      offset = newline + 1;
    }
  }

  if (!discarding && retainedBytes > 0) yield decodeRetainedLine();
}

export interface TranscriptReadResult {
  readonly records: readonly UsageRecord[];
  readonly oversizedRecords: number;
  readonly recordLimitReached: boolean;
}

/**
 * Lists `.jsonl` transcripts under `root` last modified at or after `sinceMs`.
 *
 * Errors on individual entries are swallowed: session files rotate and get
 * removed while the walk is in flight, and a partial listing is far better than
 * failing the page.
 *
 * `fileName` restricts the walk to a single basename (Grok's `updates.jsonl`).
 * Grok sessions also ship multi-megabyte `chat_history` and `events` logs that
 * never carry usage, so the basename filter keeps a cold scan off those files.
 */
export async function listTranscriptFiles(
  root: string,
  sinceMs: number,
  options?: { readonly fileName?: string } | string,
  limits: TranscriptListingLimits = {},
): Promise<TranscriptListing> {
  const found: TranscriptFile[] = [];
  const fileName = typeof options === "string" ? options : options?.fileName;
  const boundedLimit = (value: number | undefined, fallback: number) =>
    value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, Math.trunc(value));
  const maxFiles = boundedLimit(limits.maxFiles, TRANSCRIPT_FILE_MAX);
  const maxDirectories = boundedLimit(limits.maxDirectories, TRANSCRIPT_DIRECTORY_MAX);
  const maxEntries = boundedLimit(limits.maxEntries, TRANSCRIPT_ENTRY_MAX);
  const pendingDirectories = maxDirectories > 0 ? [root] : [];
  let openedDirectories = 0;
  let visitedEntries = 0;
  let unreadableDirectories = 0;
  let truncated = maxDirectories === 0 || maxFiles === 0 || maxEntries === 0;

  while (pendingDirectories.length > 0 && !truncated) {
    const dir = pendingDirectories.pop();
    if (dir === undefined) break;
    openedDirectories += 1;

    let entries;
    try {
      entries = await NodeFSP.opendir(dir);
    } catch {
      unreadableDirectories += 1;
      continue;
    }

    for await (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > maxEntries) {
        truncated = true;
        break;
      }

      const child = NodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (openedDirectories + pendingDirectories.length >= maxDirectories) {
          truncated = true;
          break;
        }
        pendingDirectories.push(child);
        continue;
      }
      if (fileName !== undefined ? entry.name !== fileName : !entry.name.endsWith(".jsonl")) {
        continue;
      }

      try {
        const stats = await NodeFSP.stat(child);
        if (stats.mtimeMs >= sinceMs) {
          found.push({ path: child, size: stats.size, mtimeMs: stats.mtimeMs });
          if (found.length >= maxFiles) {
            truncated = true;
            break;
          }
        }
      } catch {
        // Vanished between directory iteration and stat.
      }
    }
  }

  return { files: found, truncated, unreadableDirectories };
}

/**
 * Filesystem identity of a directory, as `device:inode`.
 *
 * Used to tell "two servers reading the same transcript directory" apart from
 * "two machines whose hostname and home path happen to match". Returns an empty
 * string when the directory cannot be stat'd.
 */
export async function readDirectoryVolumeId(path: string): Promise<string> {
  try {
    const stats = await NodeFSP.stat(path);
    return `${stats.dev}:${stats.ino}`;
  } catch {
    return "";
  }
}

/**
 * Streams one transcript and returns the usage records it contains, or `null`
 * when the file could not be read.
 *
 * The distinction matters to the caller's cache: a genuinely empty transcript
 * is a stable fact worth memoising, while a transient read failure memoised
 * under the same `(size, mtime)` key would silently drop that file's usage
 * until the file next changes.
 *
 * Codex carries the active model on `turn_context` lines that hold no usage of
 * their own, so those still have to pass through the reducer to keep model
 * attribution correct.
 */
export async function readTranscriptRecords(
  filePath: string,
  provider: UsageProviderKind,
  maxRecords = TRANSCRIPT_FILE_RECORD_MAX,
): Promise<TranscriptReadResult | null> {
  const records: UsageRecord[] = [];
  const codexState = initialCodexScanState();
  const boundedMaxRecords = Number.isFinite(maxRecords) ? Math.max(0, Math.trunc(maxRecords)) : 0;
  let oversizedRecords = 0;
  let recordLimitReached = boundedMaxRecords === 0;

  if (recordLimitReached) return { records, oversizedRecords, recordLimitReached };

  const appendRecord = (record: UsageRecord | null): boolean => {
    if (record === null) return false;
    records.push(record);
    if (records.length < boundedMaxRecords) return false;
    recordLimitReached = true;
    return true;
  };

  try {
    const lines = readUtf8LinesWithinLimit(
      NodeFS.createReadStream(filePath),
      TRANSCRIPT_LINE_MAX_BYTES,
      () => {
        oversizedRecords += 1;
      },
    );

    const kimiSessionId = provider === "kimi" ? kimiSessionIdFromPath(filePath) : "";

    for await (const line of lines) {
      if (provider === "codex") {
        if (
          !mightCarryUsage(line, provider) &&
          !line.includes('"turn_context"') &&
          !line.includes('"session_meta"')
        ) {
          continue;
        }
        const record = parseCodexLine(line, codexState);
        if (appendRecord(record)) break;
        continue;
      }

      if (provider === "grok") {
        if (!mightCarryUsage(line, provider)) continue;
        if (parseGrokLine(line).some(appendRecord)) break;
        continue;
      }

      if (!mightCarryUsage(line, provider)) continue;

      const record =
        provider === "kimi" ? parseKimiLine(line, kimiSessionId) : parseClaudeLine(line);
      if (appendRecord(record)) break;
    }
  } catch {
    return null;
  }

  return { records, oversizedRecords, recordLimitReached };
}
