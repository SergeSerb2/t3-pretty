// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { parseDuKilobytes, walkDirectoryOnDiskBytes } from "./directorySize.ts";

describe("directory size", () => {
  it("parses du -sk stdout as allocated bytes", () => {
    expect(parseDuKilobytes("12\t/tmp/worktrees/app\n")).toBe(12 * 1024);
    expect(parseDuKilobytes("0\t.\n")).toBe(0);
    expect(parseDuKilobytes("not-a-number\n")).toBeNull();
  });

  it("walks a small tree and counts file bytes", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-directory-size-"));
    try {
      await NodeFSP.writeFile(NodePath.join(root, "a.txt"), "hello\n");
      await NodeFSP.mkdir(NodePath.join(root, "nested"));
      await NodeFSP.writeFile(NodePath.join(root, "nested", "b.txt"), "world\n");
      const bytes = await walkDirectoryOnDiskBytes(root);
      expect(bytes).toBeGreaterThan(0);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
