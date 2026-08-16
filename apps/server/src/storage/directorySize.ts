// Node walk stays off the Effect FileSystem so a worktree is one syscall
// batch, not one fiber per file.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

export function parseDuKilobytes(stdout: string): number | null {
  const match = /^(\d+)\s/u.exec(stdout);
  if (match === null) return null;
  const kilobytes = Number(match[1]);
  if (!Number.isFinite(kilobytes) || kilobytes < 0) return null;
  return kilobytes * 1024;
}

function onDiskBytes(stat: { readonly size: number; readonly blocks?: number }): number {
  if (typeof stat.blocks === "number" && stat.blocks > 0) {
    return stat.blocks * 512;
  }
  return stat.size;
}

export async function walkDirectoryOnDiskBytes(root: string): Promise<number> {
  const visited = new Set<string>();
  const stack = [root];
  let total = 0;

  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const resolved = NodePath.resolve(current);
    if (visited.has(resolved)) continue;
    visited.add(resolved);

    let entries;
    try {
      entries = await NodeFSP.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    const files: string[] = [];
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      if (entry.isSymbolicLink()) continue;
      const child = NodePath.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile()) {
        files.push(child);
      }
    }

    if (files.length === 0) continue;
    const sizes = await Promise.all(
      files.map(async (file) => {
        try {
          return onDiskBytes(await NodeFSP.stat(file));
        } catch {
          return 0;
        }
      }),
    );
    for (const size of sizes) {
      total += size;
    }
  }

  return total;
}

export async function directoryOnDiskBytes(
  root: string,
  platform: NodeJS.Platform,
): Promise<number> {
  try {
    if (platform !== "win32") {
      try {
        const { stdout } = await execFile("du", ["-sk", root], {
          timeout: 120_000,
          maxBuffer: 1024 * 1024,
        });
        const bytes = parseDuKilobytes(stdout);
        if (bytes !== null) return bytes;
      } catch {
        // Fall through to the portable walk when `du` is missing or refused.
      }
    }
    return await walkDirectoryOnDiskBytes(root);
  } catch {
    return 0;
  }
}
