// Node walk stays off the Effect FileSystem so directory entries and file
// metadata can be consumed in bounded batches instead of one fiber per file.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

/** Cap in-flight `stat` calls per directory so a flat tree cannot enqueue one promise per file. */
const STAT_CONCURRENCY = 64;

function safeByteCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value));
}

function addByteCounts(left: number, right: number): number {
  if (right >= Number.MAX_SAFE_INTEGER - left) return Number.MAX_SAFE_INTEGER;
  return left + right;
}

export function parseDuKilobytes(stdout: string): number | null {
  const match = /^(\d+)\s/u.exec(stdout);
  if (match === null) return null;
  const kilobytes = Number(match[1]);
  if (!Number.isFinite(kilobytes) || kilobytes < 0) return null;
  return safeByteCount(kilobytes * 1024);
}

function onDiskBytes(stat: { readonly size: number; readonly blocks?: number }): number {
  if (typeof stat.blocks === "number" && stat.blocks > 0) {
    return safeByteCount(stat.blocks * 512);
  }
  return safeByteCount(stat.size);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const reason = signal.reason;
    if (reason instanceof Error) throw reason;
    const error = new Error("The directory size operation was aborted.");
    error.name = "AbortError";
    throw error;
  }
}

export async function walkDirectoryOnDiskBytes(
  root: string,
  signal?: AbortSignal,
): Promise<number> {
  const stack = [root];
  let total = 0;

  while (stack.length > 0) {
    throwIfAborted(signal);
    const current = stack.pop();
    if (current === undefined) break;
    let directory: Awaited<ReturnType<typeof NodeFSP.opendir>> | null = null;
    const files: string[] = [];
    const flushFiles = async () => {
      if (files.length === 0) return;
      throwIfAborted(signal);
      const sizes = await Promise.all(
        files.splice(0).map(async (file) => {
          try {
            return onDiskBytes(await NodeFSP.stat(file));
          } catch (error) {
            throwIfAborted(signal);
            if (isAbortError(error)) throw error;
            return 0;
          }
        }),
      );
      for (const size of sizes) total = addByteCounts(total, size);
    };
    try {
      directory = await NodeFSP.opendir(current);
      while (true) {
        throwIfAborted(signal);
        const entry = await directory.read();
        if (entry === null) break;
        if (entry.name === "." || entry.name === ".." || entry.isSymbolicLink()) continue;
        const child = NodePath.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(child);
        } else if (entry.isFile()) {
          files.push(child);
          if (files.length >= STAT_CONCURRENCY) await flushFiles();
        }
      }
      await flushFiles();
    } catch (error) {
      throwIfAborted(signal);
      if (isAbortError(error)) throw error;
    } finally {
      if (directory !== null) {
        await directory.close().catch(() => undefined);
      }
    }
  }

  return total;
}

export async function directoryOnDiskBytes(
  root: string,
  platform: NodeJS.Platform,
  signal?: AbortSignal,
): Promise<number> {
  throwIfAborted(signal);
  try {
    if (platform !== "win32") {
      try {
        const { stdout } = await execFile("du", ["-sk", root], {
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
          ...(signal === undefined ? {} : { signal }),
        });
        const bytes = parseDuKilobytes(stdout);
        if (bytes !== null) return bytes;
      } catch (error) {
        if (isAbortError(error)) throw error;
        // Fall through to the portable walk when `du` is missing or refused.
      }
    }
    return await walkDirectoryOnDiskBytes(root, signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    return 0;
  }
}
