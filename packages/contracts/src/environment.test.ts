import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { ExecutionEnvironmentDescriptor } from "./environment.ts";

const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);

const descriptor = {
  environmentId: "environment-1",
  label: "Local",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "0.0.32",
  capabilities: { repositoryIdentity: true },
} as const;

describe("ExecutionEnvironmentDescriptor", () => {
  it("treats a missing pull-request capability as unsupported under version skew", () => {
    expect(decodeDescriptor(descriptor).capabilities.pullRequests).toBeUndefined();
  });

  it("preserves an advertised pull-request capability", () => {
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, pullRequests: true },
      }).capabilities.pullRequests,
    ).toBe(true);
  });

  it("treats a missing canvas capability as unsupported under version skew", () => {
    expect(decodeDescriptor(descriptor).capabilities.canvas).toBeUndefined();
  });

  it("preserves an advertised canvas capability", () => {
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, canvas: true },
      }).capabilities.canvas,
    ).toBe(true);
  });

  it("treats a missing provider-handoff capability as unsupported under version skew", () => {
    expect(decodeDescriptor(descriptor).capabilities.providerHandoff).toBeUndefined();
  });

  it("preserves an advertised provider-handoff capability", () => {
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, providerHandoff: true },
      }).capabilities.providerHandoff,
    ).toBe(true);
  });

  it("treats a missing storage-inventory capability as unsupported under version skew", () => {
    expect(decodeDescriptor(descriptor).capabilities.storageInventory).toBeUndefined();
  });

  it("preserves an advertised storage-inventory capability", () => {
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, storageInventory: true },
      }).capabilities.storageInventory,
    ).toBe(true);
  });
});
