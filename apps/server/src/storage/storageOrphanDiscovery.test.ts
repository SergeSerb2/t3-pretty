// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { discoverStorageOrphans } from "./storageOrphanDiscovery.ts";

let root = "";

beforeEach(async () => {
  root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-storage-orphans-"));
});

afterEach(async () => {
  if (root.length > 0) await NodeFSP.rm(root, { recursive: true, force: true });
});

async function checkout(relativePath: string): Promise<string> {
  const target = NodePath.join(root, relativePath);
  await NodeFSP.mkdir(NodePath.join(target, "src", "nested"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(target, ".git"), "gitdir: /repo/.git/worktrees/x\n");
  return target;
}

describe("discoverStorageOrphans", () => {
  it("returns the checkout root without mislabeling nested leaf directories", async () => {
    const stale = await checkout(NodePath.join("app", "stale"));

    const result = await discoverStorageOrphans({
      root,
      ownedPaths: new Set(),
      maxDepth: 4,
      maxCandidates: 10,
    });

    expect(result.candidates.map((candidate) => candidate.path)).toEqual([stale]);
  });

  it("protects an owned checkout while retaining its orphan sibling", async () => {
    const owned = await checkout(NodePath.join("app", "owned"));
    const stale = await checkout(NodePath.join("app", "stale"));

    const result = await discoverStorageOrphans({
      root,
      ownedPaths: new Set([owned]),
      maxDepth: 4,
      maxCandidates: 10,
    });

    expect(result.candidates.map((candidate) => candidate.path)).toEqual([stale]);
  });

  it("stops a flat discovery at the directory budget and marks it truncated", async () => {
    await Promise.all([checkout("one"), checkout("two"), checkout("three")]);

    const result = await discoverStorageOrphans({
      root,
      ownedPaths: new Set(),
      maxDepth: 2,
      maxCandidates: 10,
      maxDirectories: 3,
      maxEntries: 100,
    });

    expect(result.truncated).toBe(true);
    expect(result.candidates.length).toBeLessThanOrEqual(2);
  });
});
