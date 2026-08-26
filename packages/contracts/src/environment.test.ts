import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ENVIRONMENT_LABEL_MAX_LENGTH,
  ExecutionEnvironmentDescriptor,
  REPOSITORY_IDENTITY_REMOTE_URL_MAX_LENGTH,
  RepositoryIdentity,
} from "./environment.ts";

const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);
const decodeRepositoryIdentity = Schema.decodeUnknownSync(RepositoryIdentity);

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

  it("rejects environment labels above the wire ceiling", () => {
    expect(() =>
      decodeDescriptor({ ...descriptor, label: "x".repeat(ENVIRONMENT_LABEL_MAX_LENGTH + 1) }),
    ).toThrow();
  });

  it("rejects repository remote URLs above the wire ceiling", () => {
    expect(() =>
      decodeRepositoryIdentity({
        canonicalKey: "example.com/acme/app",
        locator: {
          source: "git-remote",
          remoteName: "origin",
          remoteUrl: `https://example.com/${"x".repeat(REPOSITORY_IDENTITY_REMOTE_URL_MAX_LENGTH)}`,
        },
      }),
    ).toThrow();
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

  it("treats a missing storage-inventory-stream capability as unsupported under version skew", () => {
    expect(decodeDescriptor(descriptor).capabilities.storageInventoryStream).toBeUndefined();
  });

  it("preserves an advertised storage-inventory-stream capability", () => {
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, storageInventoryStream: true },
      }).capabilities.storageInventoryStream,
    ).toBe(true);
  });

  it("treats a missing attachment upload capability as unsupported", () => {
    expect(decodeDescriptor(descriptor).capabilities.attachmentUploads).toBeUndefined();
  });

  it("preserves an advertised attachment upload capability", () => {
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, attachmentUploads: true },
      }).capabilities.attachmentUploads,
    ).toBe(true);
  });
});
