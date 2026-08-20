import { describe, expect, it, vi } from "vite-plus/test";

import { handleRootMenuOpenChange, isSpuriousRootSiblingOpen } from "./menu.logic";

describe("isSpuriousRootSiblingOpen", () => {
  it("keeps a standalone root open when a nested submenu reports sibling-open", () => {
    expect(isSpuriousRootSiblingOpen(false, "sibling-open")).toBe(true);
    expect(
      isSpuriousRootSiblingOpen(false, "sibling-open", {
        closest: () => null,
      }),
    ).toBe(true);
  });

  it("still allows real dismissals", () => {
    expect(isSpuriousRootSiblingOpen(false, "outside-press")).toBe(false);
    expect(isSpuriousRootSiblingOpen(false, "escape-key")).toBe(false);
    expect(isSpuriousRootSiblingOpen(false, "item-press")).toBe(false);
    expect(isSpuriousRootSiblingOpen(false, "focus-out")).toBe(false);
    expect(isSpuriousRootSiblingOpen(true, "sibling-open")).toBe(false);
    expect(isSpuriousRootSiblingOpen(false, undefined)).toBe(false);
  });

  it("still allows menubar roots to close when a sibling menu opens", () => {
    const trigger = {
      closest: (selector: string) => (selector === "[role='menubar']" ? ({} as Element) : null),
    };
    expect(isSpuriousRootSiblingOpen(false, "sibling-open", trigger)).toBe(false);
  });

  it("cancels the spurious close and does not notify the host", () => {
    const cancel = vi.fn();
    const onOpenChange = vi.fn();
    handleRootMenuOpenChange(false, { reason: "sibling-open", cancel }, onOpenChange);
    expect(cancel).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("forwards menubar sibling dismiss to the host", () => {
    const cancel = vi.fn();
    const onOpenChange = vi.fn();
    const details = {
      reason: "sibling-open" as const,
      cancel,
      trigger: {
        closest: (selector: string) => (selector === "[role='menubar']" ? ({} as Element) : null),
      },
    };
    handleRootMenuOpenChange(false, details, onOpenChange);
    expect(cancel).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false, details);
  });

  it("forwards real dismissals to the host", () => {
    const cancel = vi.fn();
    const onOpenChange = vi.fn();
    const details = { reason: "outside-press", cancel };
    handleRootMenuOpenChange(false, details, onOpenChange);
    expect(cancel).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false, details);
  });
});
