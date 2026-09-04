import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  BackgroundPolicySnapshot,
  CLIENT_ACTIVITY_CLIENT_ID_MAX_LENGTH,
  CLIENT_ACTIVITY_MAX_ACTIVE_SCOPE_KEYS,
  CLIENT_ACTIVITY_MAX_LEASES,
  CLIENT_ACTIVITY_MAX_LEASE_TTL_MS,
  CLIENT_ACTIVITY_MAX_SCOPES,
  CLIENT_ACTIVITY_MAX_SCOPE_KEY_CHARS,
  CLIENT_ACTIVITY_MIN_LEASE_TTL_MS,
  CLIENT_ACTIVITY_NETWORK_TYPE_MAX_LENGTH,
  ClientActivityClientId,
  ClientActivityReportInput,
} from "./background.ts";

const decodeClientActivityClientId = Schema.decodeUnknownSync(ClientActivityClientId);
const decodeClientActivityReport = Schema.decodeUnknownSync(ClientActivityReportInput);
const decodeBackgroundPolicySnapshot = Schema.decodeUnknownSync(BackgroundPolicySnapshot);
const NOW = DateTime.makeUnsafe("2026-08-23T00:00:00.000Z");

describe("ClientActivityClientId", () => {
  it("trims and accepts bounded client identifiers", () => {
    expect(decodeClientActivityClientId("  client-1  ")).toBe("client-1");
    expect(decodeClientActivityClientId("x".repeat(CLIENT_ACTIVITY_CLIENT_ID_MAX_LENGTH))).toBe(
      "x".repeat(CLIENT_ACTIVITY_CLIENT_ID_MAX_LENGTH),
    );
  });

  it("rejects empty and oversized client identifiers", () => {
    expect(() => decodeClientActivityClientId("   ")).toThrow();
    expect(() =>
      decodeClientActivityClientId("x".repeat(CLIENT_ACTIVITY_CLIENT_ID_MAX_LENGTH + 1)),
    ).toThrow();
  });
});

const report = (overrides: Record<string, unknown> = {}) => ({
  clientId: "client-1",
  clientKind: "web",
  visible: true,
  focused: true,
  recentlyInteracted: true,
  scopes: [{ type: "diagnostics" }],
  observedAt: NOW,
  ...overrides,
});

describe("ClientActivityReportInput bounds", () => {
  it("accepts the server lease TTL policy endpoints", () => {
    expect(
      decodeClientActivityReport(report({ ttlMs: CLIENT_ACTIVITY_MIN_LEASE_TTL_MS })).ttlMs,
    ).toBe(CLIENT_ACTIVITY_MIN_LEASE_TTL_MS);
    expect(
      decodeClientActivityReport(report({ ttlMs: CLIENT_ACTIVITY_MAX_LEASE_TTL_MS })).ttlMs,
    ).toBe(CLIENT_ACTIVITY_MAX_LEASE_TTL_MS);
  });

  it("rejects out-of-policy TTLs and oversized network labels", () => {
    expect(() =>
      decodeClientActivityReport(report({ ttlMs: CLIENT_ACTIVITY_MIN_LEASE_TTL_MS - 1 })),
    ).toThrow();
    expect(() =>
      decodeClientActivityReport(report({ ttlMs: CLIENT_ACTIVITY_MAX_LEASE_TTL_MS + 1 })),
    ).toThrow();
    expect(() =>
      decodeClientActivityReport(
        report({ networkType: "x".repeat(CLIENT_ACTIVITY_NETWORK_TYPE_MAX_LENGTH + 1) }),
      ),
    ).toThrow();
  });

  it("rejects excessive scope counts and aggregate path characters", () => {
    expect(() =>
      decodeClientActivityReport(
        report({
          scopes: Array.from({ length: CLIENT_ACTIVITY_MAX_SCOPES + 1 }, () => ({
            type: "diagnostics",
          })),
        }),
      ),
    ).toThrow();

    const pathLength = Math.floor(CLIENT_ACTIVITY_MAX_SCOPE_KEY_CHARS / 3) + 1;
    expect(() =>
      decodeClientActivityReport(
        report({
          scopes: Array.from({ length: 3 }, (_, index) => ({
            type: "vcs-status",
            cwd: `/${String(index).repeat(pathLength - 1)}`,
          })),
        }),
      ),
    ).toThrow();
  });
});

const lease = {
  sessionId: "session-1",
  rpcClientId: 1,
  clientId: "client-1",
  clientKind: "web",
  visible: true,
  focused: true,
  recentlyInteracted: true,
  scopes: [{ type: "diagnostics" }],
  updatedAt: NOW,
  expiresAt: NOW,
};

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  hostPower: {
    source: "unknown",
    idle: "unknown",
    idleSeconds: null,
    locked: "unknown",
    suspended: false,
    onBattery: "unknown",
    lowPowerMode: "unknown",
    thermalState: "unknown",
    stale: true,
    updatedAt: NOW,
  },
  leases: [],
  activeForegroundLeaseCount: 0,
  activeScopeKeys: [],
  shouldRunOpportunisticWork: false,
  updatedAt: NOW,
  ...overrides,
});

describe("BackgroundPolicySnapshot bounds", () => {
  it("rejects lease and active-scope collections beyond server policy", () => {
    expect(() =>
      decodeBackgroundPolicySnapshot(
        snapshot({ leases: Array.from({ length: CLIENT_ACTIVITY_MAX_LEASES + 1 }, () => lease) }),
      ),
    ).toThrow();
    expect(() =>
      decodeBackgroundPolicySnapshot(
        snapshot({
          activeScopeKeys: Array.from(
            { length: CLIENT_ACTIVITY_MAX_ACTIVE_SCOPE_KEYS + 1 },
            () => "diagnostics",
          ),
        }),
      ),
    ).toThrow();
  });
});
