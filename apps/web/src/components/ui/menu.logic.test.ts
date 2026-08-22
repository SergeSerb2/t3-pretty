import { describe, expect, it, vi } from "vite-plus/test";

import {
  handleRootMenuOpenChange,
  isSpuriousNestedMenuDismiss,
  isSpuriousRootSiblingOpen,
} from "./menu.logic";

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

describe("isSpuriousNestedMenuDismiss", () => {
  const itemTarget = {
    closest: (selector: string) => (selector.includes("menu-item") ? ({} as Element) : null),
  };

  it("keeps the root open when the press lands on an item in a nested popup", () => {
    expect(
      isSpuriousNestedMenuDismiss(false, "outside-press", {
        target: itemTarget,
      } as unknown as Event),
    ).toBe(true);
    const cancel = vi.fn();
    const onOpenChange = vi.fn();
    const details = {
      reason: "outside-press" as const,
      cancel,
      event: { target: itemTarget } as unknown as Event,
    };
    handleRootMenuOpenChange(false, details, onOpenChange);
    expect(cancel).toHaveBeenCalledOnce();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("still dismisses a press on popup padding that selects nothing", () => {
    const popupPadding = {
      closest: (selector: string) => (selector.includes("menu-popup") ? ({} as Element) : null),
    };
    expect(
      isSpuriousNestedMenuDismiss(false, "outside-press", {
        target: popupPadding,
      } as unknown as Event),
    ).toBe(false);
  });

  it("still dismisses a press outside any menu popup", () => {
    const outside = {
      closest: () => null,
    };
    expect(
      isSpuriousNestedMenuDismiss(false, "outside-press", {
        target: outside,
      } as unknown as Event),
    ).toBe(false);
  });
});
