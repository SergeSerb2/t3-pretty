import type { ScopedThreadRef } from "@t3tools/contracts";
import { assert, describe, it } from "vite-plus/test";
import {
  buildVisibleToastLayout,
  hasVisibleToastAction,
  resolveToastAutoDismissMs,
  shouldHideCollapsedToastContent,
  shouldRenderThreadScopedToast,
  shouldRunToastAutoDismissTimer,
  stripToastTimeout,
  TOAST_AUTO_DISMISS_MS,
} from "./toast.logic";

describe("hasVisibleToastAction", () => {
  it("treats a labeled action as visible", () => {
    assert.equal(hasVisibleToastAction({ children: "Update" }), true);
  });

  it("hides an explicit empty action used to clear a previous CTA", () => {
    assert.equal(hasVisibleToastAction({ children: null }), false);
    assert.equal(hasVisibleToastAction({ children: "" }), false);
    assert.equal(hasVisibleToastAction(undefined), false);
  });
});

describe("resolveToastAutoDismissMs", () => {
  it("uses type defaults when the caller omitted a timeout", () => {
    assert.equal(resolveToastAutoDismissMs({ type: "success" }), TOAST_AUTO_DISMISS_MS.success);
    assert.equal(resolveToastAutoDismissMs({ type: "info" }), TOAST_AUTO_DISMISS_MS.info);
    assert.equal(resolveToastAutoDismissMs({ type: "warning" }), TOAST_AUTO_DISMISS_MS.warning);
    assert.equal(resolveToastAutoDismissMs({ type: "error" }), TOAST_AUTO_DISMISS_MS.error);
    assert.equal(resolveToastAutoDismissMs({}), TOAST_AUTO_DISMISS_MS.success);
  });

  it("keeps loading and explicit persist toasts on screen", () => {
    assert.equal(resolveToastAutoDismissMs({ type: "loading" }), undefined);
    assert.equal(
      resolveToastAutoDismissMs({ type: "loading", timeout: 5_000, dismissAfterVisibleMs: 5_000 }),
      undefined,
    );
    assert.equal(
      resolveToastAutoDismissMs({ type: "success", dismissAfterVisibleMs: 0 }),
      undefined,
    );
  });

  it("does not treat provider timeout 0 as persist", () => {
    assert.equal(resolveToastAutoDismissMs({ type: "success", timeout: 0 }), 5_000);
    assert.equal(
      resolveToastAutoDismissMs({ type: "info", timeout: 0 }),
      TOAST_AUTO_DISMISS_MS.info,
    );
    assert.equal(
      resolveToastAutoDismissMs({ type: "warning", timeout: 0 }),
      TOAST_AUTO_DISMISS_MS.warning,
    );
    assert.equal(
      resolveToastAutoDismissMs({ type: "error", timeout: 0 }),
      TOAST_AUTO_DISMISS_MS.error,
    );
  });

  it("honors an explicit timeout and visible-ms override", () => {
    assert.equal(resolveToastAutoDismissMs({ type: "success", timeout: 5_000 }), 5_000);
    assert.equal(
      resolveToastAutoDismissMs({ type: "error", timeout: 0, dismissAfterVisibleMs: 10_000 }),
      10_000,
    );
    assert.equal(
      resolveToastAutoDismissMs({ type: "success", dismissAfterVisibleMs: 0 }),
      undefined,
    );
  });
});

describe("stripToastTimeout", () => {
  it("moves an explicit timeout onto dismissAfterVisibleMs", () => {
    const options: {
      title: string;
      timeout?: number;
      data?: { dismissAfterVisibleMs?: number };
    } = { title: "Snoozed", timeout: 5_000 };
    assert.deepEqual(stripToastTimeout(options), {
      title: "Snoozed",
      timeout: 0,
      data: { dismissAfterVisibleMs: 5_000 },
    });
  });

  it("marks explicit timeout 0 as persist without clobbering a visible-ms override", () => {
    const options: {
      title: string;
      timeout?: number;
      data?: { dismissAfterVisibleMs?: number };
    } = { title: "Working", timeout: 0 };
    assert.deepEqual(stripToastTimeout(options), {
      title: "Working",
      timeout: 0,
      data: { dismissAfterVisibleMs: 0 },
    });
    const missing: { title: string; timeout?: number } = { title: "Copied" };
    assert.equal(stripToastTimeout(missing), missing);
    assert.deepEqual(stripToastTimeout({ timeout: 0, data: { dismissAfterVisibleMs: 10_000 } }), {
      timeout: 0,
      data: { dismissAfterVisibleMs: 10_000 },
    });
    assert.deepEqual(
      stripToastTimeout({ timeout: 5_000, data: { dismissAfterVisibleMs: 3_000 } }),
      { timeout: 0, data: { dismissAfterVisibleMs: 3_000 } },
    );
  });

  it("does not turn a loading or persist timeout into a dismiss duration", () => {
    assert.deepEqual(stripToastTimeout({ type: "loading", timeout: 5_000 }), {
      type: "loading",
      timeout: 0,
    });
    assert.deepEqual(
      stripToastTimeout({ type: "warning", timeout: 5_000, data: { dismissAfterVisibleMs: 0 } }),
      { type: "warning", timeout: 0, data: { dismissAfterVisibleMs: 0 } },
    );
  });
});

describe("shouldRunToastAutoDismissTimer", () => {
  it("runs while the document is visible even without window focus", () => {
    assert.equal(shouldRunToastAutoDismissTimer("visible"), true);
    assert.equal(shouldRunToastAutoDismissTimer("hidden"), false);
  });
});

describe("shouldHideCollapsedToastContent", () => {
  it("keeps a single visible toast readable", () => {
    assert.equal(shouldHideCollapsedToastContent(0, 1), false);
  });

  it("keeps the front-most toast readable in a visible stack", () => {
    assert.equal(shouldHideCollapsedToastContent(0, 3), false);
  });

  it("hides non-front toasts until the stack is expanded", () => {
    assert.equal(shouldHideCollapsedToastContent(1, 3), true);
  });
});

describe("buildVisibleToastLayout", () => {
  it("computes indices and offsets from the visible subset", () => {
    const visibleToasts = [
      { id: "a", height: 48 },
      { id: "b", height: 72 },
      { id: "c", height: 24 },
    ];

    const layout = buildVisibleToastLayout(visibleToasts);

    assert.equal(layout.frontmostHeight, 48);
    assert.deepEqual(
      layout.items.map(({ toast, visibleIndex, offsetY }) => ({
        id: toast.id,
        visibleIndex,
        offsetY,
      })),
      [
        { id: "a", visibleIndex: 0, offsetY: 0 },
        { id: "b", visibleIndex: 1, offsetY: 48 },
        { id: "c", visibleIndex: 2, offsetY: 120 },
      ],
    );
  });

  it("reflows live toasts forward when the front toast is dismissed", () => {
    const visibleToasts = [
      { id: "a", height: 48, transitionStatus: "ending" as const },
      { id: "b", height: 72 },
      { id: "c", height: 24 },
    ];

    const layout = buildVisibleToastLayout(visibleToasts);

    // frontmost height should be the first live toast, not the ending one
    assert.equal(layout.frontmostHeight, 72);
    assert.deepEqual(
      layout.items.map(({ toast, visibleIndex, offsetY }) => ({
        id: toast.id,
        visibleIndex,
        offsetY,
      })),
      [
        // Ending toast stays at its front slot; data-ending-style drives its exit
        { id: "a", visibleIndex: 0, offsetY: 0 },
        // Live toasts get fresh indices starting at 0 so they move up in sync
        { id: "b", visibleIndex: 0, offsetY: 0 },
        { id: "c", visibleIndex: 1, offsetY: 72 },
      ],
    );
  });

  it("keeps a non-front ending toast at its current slot so it exits straight", () => {
    const visibleToasts = [
      { id: "a", height: 48 },
      { id: "b", height: 72, transitionStatus: "ending" as const },
      { id: "c", height: 24 },
    ];

    const layout = buildVisibleToastLayout(visibleToasts);

    // front toast stays, so frontmost height is unchanged
    assert.equal(layout.frontmostHeight, 48);
    assert.deepEqual(
      layout.items.map(({ toast, visibleIndex, offsetY }) => ({
        id: toast.id,
        visibleIndex,
        offsetY,
      })),
      [
        // Front live toast — unaffected
        { id: "a", visibleIndex: 0, offsetY: 0 },
        // Ending toast keeps its pre-dismissal slot so its horizontal exit
        // originates from where the user saw it (not from Y=0).
        { id: "b", visibleIndex: 1, offsetY: 48 },
        // Live toast behind "b" slides forward into the vacated slot.
        { id: "c", visibleIndex: 1, offsetY: 48 },
      ],
    );
  });

  it("treats missing heights as zero", () => {
    const layout = buildVisibleToastLayout([
      { id: "a" },
      { id: "b", height: undefined },
      { id: "c", height: 30 },
    ]);

    assert.equal(layout.frontmostHeight, 0);
    assert.deepEqual(
      layout.items.map(({ toast, offsetY }) => ({
        id: toast.id,
        offsetY,
      })),
      [
        { id: "a", offsetY: 0 },
        { id: "b", offsetY: 0 },
        { id: "c", offsetY: 0 },
      ],
    );
  });
});

describe("shouldRenderThreadScopedToast", () => {
  const activeThreadRef = {
    environmentId: "environment-a",
    threadId: "thread-1",
  } as ScopedThreadRef;

  it("renders a toast scoped to the active thread ref", () => {
    assert.equal(
      shouldRenderThreadScopedToast(
        {
          threadRef: activeThreadRef,
        },
        activeThreadRef,
      ),
      true,
    );
  });

  it("hides a scoped toast when the environment differs", () => {
    assert.equal(
      shouldRenderThreadScopedToast(
        {
          threadRef: {
            environmentId: "environment-b",
            threadId: "thread-1",
          } as ScopedThreadRef,
        },
        activeThreadRef,
      ),
      false,
    );
  });

  it("keeps legacy thread-id scoped toasts working", () => {
    assert.equal(
      shouldRenderThreadScopedToast(
        {
          threadId: "thread-1" as never,
        },
        activeThreadRef,
      ),
      true,
    );
  });
});
