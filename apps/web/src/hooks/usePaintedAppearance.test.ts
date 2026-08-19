import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { paintedAppearanceFromDocument } from "./usePaintedAppearance";
import hookSource from "./usePaintedAppearance.ts?raw";

describe("paintedAppearanceFromDocument", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats a missing document as light", () => {
    expect(paintedAppearanceFromDocument()).toBe("light");
  });

  it("reads light when html has no dark class", () => {
    vi.stubGlobal("document", {
      documentElement: { classList: { contains: () => false } },
    });
    expect(paintedAppearanceFromDocument()).toBe("light");
  });

  it("reads dark from the painted html class, not a stored preference", () => {
    vi.stubGlobal("document", {
      documentElement: { classList: { contains: (name: string) => name === "dark" } },
    });
    expect(paintedAppearanceFromDocument()).toBe("dark");
  });

  it("uses the painted html class for both live and hydration snapshots", () => {
    expect(hookSource).toContain(
      "useSyncExternalStore(\n    subscribe,\n    paintedAppearanceFromDocument,\n    paintedAppearanceFromDocument,",
    );
    expect(hookSource).not.toContain('() => "light"');
  });
});
