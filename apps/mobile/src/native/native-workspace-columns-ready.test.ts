import { describe, expect, it } from "vite-plus/test";

import { nativeWorkspaceColumnsAreReady } from "./native-workspace-columns-ready";

describe("nativeWorkspaceColumnsAreReady", () => {
  it("attaches immediately on iPad and on clients without LayoutMetrics", () => {
    expect(
      nativeWorkspaceColumnsAreReady({
        isPad: true,
        hasLayoutMetricsPrototype: true,
        hasMetrics: false,
        timedOut: false,
      }),
    ).toBe(true);
    expect(
      nativeWorkspaceColumnsAreReady({
        isPad: false,
        hasLayoutMetricsPrototype: false,
        hasMetrics: false,
        timedOut: false,
      }),
    ).toBe(true);
  });

  it("waits for published metrics on an iPhone that advertises LayoutMetrics", () => {
    expect(
      nativeWorkspaceColumnsAreReady({
        isPad: false,
        hasLayoutMetricsPrototype: true,
        hasMetrics: false,
        timedOut: false,
      }),
    ).toBe(false);
    expect(
      nativeWorkspaceColumnsAreReady({
        isPad: false,
        hasLayoutMetricsPrototype: true,
        hasMetrics: true,
        timedOut: false,
      }),
    ).toBe(true);
  });

  it("fails open when iOS never publishes hinge-gated metrics", () => {
    expect(
      nativeWorkspaceColumnsAreReady({
        isPad: false,
        hasLayoutMetricsPrototype: true,
        hasMetrics: false,
        timedOut: true,
      }),
    ).toBe(true);
  });
});
