// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  NATIVE_WORKSPACE_COLUMNS_READY_TIMEOUT_MS,
  nativeWorkspaceColumnsAreReady,
} from "./native/native-workspace-columns-ready";

function MobileRootBoot() {
  const ready = nativeWorkspaceColumnsAreReady({
    isPad: false,
    hasLayoutMetricsPrototype: true,
    hasMetrics: false,
    timedOut: true,
  });
  if (!ready) return null;
  return createElement("div", { "data-testid": "mobile-root-boot" }, "Home");
}

describe("mobile App boot", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  it("loads the production fail-open module without a startup exception", async () => {
    await expect(import("./native/native-workspace-columns-ready")).resolves.toMatchObject({
      NATIVE_WORKSPACE_COLUMNS_READY_TIMEOUT_MS: 400,
      nativeWorkspaceColumnsAreReady: expect.any(Function),
    });
  });

  it("paints the root after the workspace-columns fail-open timeout", () => {
    expect(() => {
      act(() => root!.render(createElement(MobileRootBoot)));
    }).not.toThrow();
    expect(container?.textContent).toContain("Home");
    expect(NATIVE_WORKSPACE_COLUMNS_READY_TIMEOUT_MS).toBe(400);
  });
});
