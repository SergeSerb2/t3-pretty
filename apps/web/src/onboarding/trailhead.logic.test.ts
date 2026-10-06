import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  resolveStepAfterBaseCamp,
  resolveStepAfterRidge,
  resolveTrailheadImportWarning,
  surveyTrailheadAgents,
} from "./trailhead.logic";

function provider(overrides: Partial<ServerProvider>): ServerProvider {
  return {
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    ...overrides,
  } as ServerProvider;
}

describe("surveyTrailheadAgents", () => {
  it("waits while providers are unknown or still probing", () => {
    expect(surveyTrailheadAgents(undefined)).toBe("checking");
    expect(surveyTrailheadAgents([])).toBe("checking");
    expect(
      surveyTrailheadAgents([
        provider({ installed: false, status: "warning", auth: { status: "unknown" } }),
      ]),
    ).toBe("checking");
  });

  it("is ready as soon as any provider is ready", () => {
    expect(
      surveyTrailheadAgents([
        provider({ installed: false, status: "error" }),
        provider({ status: "ready" }),
      ]),
    ).toBe("ready");
  });

  it("needs setup when every provider is missing or signed out", () => {
    expect(
      surveyTrailheadAgents([
        provider({ installed: false, status: "error" }),
        provider({ auth: { status: "unauthenticated" }, status: "error" }),
      ]),
    ).toBe("needsSetup");
  });
});

describe("resolveStepAfterBaseCamp", () => {
  it("skips the ridge only when every computer has an agent", () => {
    expect(resolveStepAfterBaseCamp(["ready", "ready"])).toBe("saddle");
    expect(resolveStepAfterBaseCamp(["ready", "checking"])).toBe("ridge");
    expect(resolveStepAfterBaseCamp(["needsSetup"])).toBe("ridge");
    expect(resolveStepAfterBaseCamp([])).toBe("ridge");
  });
});

describe("resolveStepAfterRidge", () => {
  const scan = { isPending: false, error: null, candidateCount: 0 };

  it("goes straight to the summit when every scan came back empty", () => {
    expect(resolveStepAfterRidge([scan, scan])).toBe("summit");
  });

  it("stops at the saddle for pending, failed, or non-empty scans", () => {
    expect(resolveStepAfterRidge([{ ...scan, isPending: true }])).toBe("saddle");
    expect(resolveStepAfterRidge([{ ...scan, error: "offline" }])).toBe("saddle");
    expect(resolveStepAfterRidge([scan, { ...scan, candidateCount: 3 }])).toBe("saddle");
    expect(resolveStepAfterRidge([])).toBe("saddle");
  });
});

describe("resolveTrailheadImportWarning", () => {
  it.each([
    [1, 1, 29, 0, null],
    [1, 0, 28, 1, "Imported 28 threads. 1 thread could not be imported."],
    [1, 0, 0, 2, "2 threads could not be imported."],
    [2, 1, 4, 0, "Imported 4 threads. Some thread history could not be imported."],
    [1, 0, 0, 0, "Could not import thread history."],
  ] as const)(
    "%i selected, %i landed, %i imported, %i skipped",
    (selectedCount, landedCount, importedThreadCount, skippedThreadCount, expected) => {
      expect(
        resolveTrailheadImportWarning({
          selectedCount,
          landedCount,
          importedThreadCount,
          skippedThreadCount,
        }),
      ).toBe(expected);
    },
  );
});
