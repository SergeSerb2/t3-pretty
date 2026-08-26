// Directory discovery is deliberately Node-native: Effect FileSystem's
// readDirectory returns a complete array, while an untrusted flat worktrees
// folder must be stoppable before every entry is retained.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { canonicalizeStoragePath, displayNameForPath } from "./storageInventory.ts";

export const STORAGE_ORPHAN_DISCOVERY_MAX_DIRECTORIES = 20_000;
export const STORAGE_ORPHAN_DISCOVERY_MAX_ENTRIES = 100_000;

export interface StorageOrphanCandidate {
  readonly path: string;
  readonly displayName: string;
  readonly looksLikeCheckout: boolean;
}

export interface StorageOrphanDiscoveryResult {
  readonly candidates: readonly StorageOrphanCandidate[];
  readonly truncated: boolean;
  readonly unreadableDirectories: number;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("Storage orphan discovery was aborted.");
  error.name = "AbortError";
  throw error;
}

function ownedAncestorPaths(root: string, ownedPaths: ReadonlySet<string>): ReadonlySet<string> {
  const ancestors = new Set<string>();
  for (const ownedPath of ownedPaths) {
    let current = NodePath.dirname(ownedPath);
    while (current === root || current.startsWith(`${root}${NodePath.sep}`)) {
      ancestors.add(current);
      if (current === root) break;
      const parent = NodePath.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return ancestors;
}

/**
 * Finds only top-level residual checkouts/leaves, stopping before descending
 * into either an owned worktree or an already identified orphan checkout.
 */
export async function discoverStorageOrphans(input: {
  readonly root: string;
  readonly ownedPaths: ReadonlySet<string>;
  readonly maxDepth: number;
  readonly maxCandidates: number;
  readonly maxDirectories?: number;
  readonly maxEntries?: number;
  readonly signal?: AbortSignal;
}): Promise<StorageOrphanDiscoveryResult> {
  const root = canonicalizeStoragePath(input.root);
  const maxDirectories = input.maxDirectories ?? STORAGE_ORPHAN_DISCOVERY_MAX_DIRECTORIES;
  const maxEntries = input.maxEntries ?? STORAGE_ORPHAN_DISCOVERY_MAX_ENTRIES;
  if (!Number.isSafeInteger(input.maxDepth) || input.maxDepth < 0) {
    throw new Error("Storage orphan discovery maxDepth must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(input.maxCandidates) || input.maxCandidates < 0) {
    throw new Error("Storage orphan discovery maxCandidates must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(maxDirectories) || maxDirectories < 1) {
    throw new Error("Storage orphan discovery maxDirectories must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error("Storage orphan discovery maxEntries must be a positive safe integer.");
  }

  const ownedPaths = new Set([...input.ownedPaths].map(canonicalizeStoragePath));
  const ownedAncestors = ownedAncestorPaths(root, ownedPaths);
  const queue: Array<{ readonly path: string; readonly depth: number }> = [
    { path: root, depth: 0 },
  ];
  const candidates: StorageOrphanCandidate[] = [];
  let cursor = 0;
  let scheduledDirectories = 1;
  let truncated = input.maxCandidates === 0;
  let unreadableDirectories = 0;
  let inspectedEntries = 0;
  let entryBudgetExhausted = false;

  while (cursor < queue.length && candidates.length < input.maxCandidates) {
    throwIfAborted(input.signal);
    const current = queue[cursor++];
    if (current === undefined) break;
    if (current.depth > 0 && ownedPaths.has(current.path)) continue;

    let directory: Awaited<ReturnType<typeof NodeFSP.opendir>> | null = null;
    let complete = true;
    let looksLikeCheckout = false;
    let hasVisibleChildDirectory = false;
    let childTraversalTruncated = false;
    const children: string[] = [];
    try {
      directory = await NodeFSP.opendir(current.path);
      while (true) {
        throwIfAborted(input.signal);
        const entry = await directory.read();
        if (entry === null) break;
        inspectedEntries += 1;
        if (inspectedEntries > maxEntries) {
          complete = false;
          truncated = true;
          entryBudgetExhausted = true;
          break;
        }
        if (entry.name === ".git") {
          looksLikeCheckout = true;
          continue;
        }
        if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
        hasVisibleChildDirectory = true;
        if (current.depth >= input.maxDepth) continue;
        if (scheduledDirectories + children.length >= maxDirectories) {
          childTraversalTruncated = true;
          truncated = true;
          if (current.depth === 0) {
            complete = false;
            break;
          }
          continue;
        }
        children.push(canonicalizeStoragePath(NodePath.join(current.path, entry.name)));
      }
    } catch {
      throwIfAborted(input.signal);
      unreadableDirectories += 1;
      complete = false;
    } finally {
      if (directory !== null) {
        await directory.close().catch(() => undefined);
      }
    }

    const isRoot = current.depth === 0;
    const protectsOwnedDescendant = ownedAncestors.has(current.path);
    const isCandidate =
      !isRoot &&
      !protectsOwnedDescendant &&
      (looksLikeCheckout || (complete && !hasVisibleChildDirectory));
    if (isCandidate) {
      candidates.push({
        path: current.path,
        displayName: displayNameForPath(current.path),
        looksLikeCheckout,
      });
      if (entryBudgetExhausted) break;
      continue;
    }

    if (entryBudgetExhausted) break;

    // An incompletely read non-root directory might itself be a checkout. Do
    // not descend and mislabel one of its leaves as a separate removable
    // orphan. Root is never removable, so its bounded prefix remains safe.
    if ((!complete && !isRoot) || (childTraversalTruncated && !looksLikeCheckout)) continue;
    for (const child of children) {
      queue.push({ path: child, depth: current.depth + 1 });
    }
    scheduledDirectories += children.length;
  }

  if (cursor < queue.length) {
    truncated = true;
  }
  return { candidates, truncated, unreadableDirectories };
}
