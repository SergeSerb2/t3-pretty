import { it } from "vite-plus/test";

import { smokeMacosBackend } from "../../../scripts/fork/smoke-macos-backend.mjs";

// Packaged Windows/macOS smokes wait for listen + this same environment probe.
// PR builds skip desktop packaging, so this is the check that the 2735 route
// layer still finishes building and binds HTTP.
it("desktop CLI reaches packaged-backend environment readiness on loopback", async () => {
  await smokeMacosBackend({
    executablePath: process.execPath,
    entryPath: `${import.meta.dirname}/bin.ts`,
    timeoutMs: 60_000,
  });
}, 70_000);
