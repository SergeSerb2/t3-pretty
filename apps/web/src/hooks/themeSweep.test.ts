// @effect-diagnostics nodeBuiltinImport:off - stylesheet contract reads index.css from disk.
import * as NodeFS from "node:fs";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import useThemeSource from "./useTheme.ts?raw";
import {
  canSweepTerminatorFront,
  cutActiveThemeSwap,
  resetMashGuard,
  retainActiveThemeSwap,
  shouldMashCut,
  sweepDirection,
} from "./themeSweep";

afterEach(() => {
  resetMashGuard();
});

describe("sweepDirection", () => {
  it("falls as dusk going dark and rises as dawn going light", () => {
    expect(sweepDirection(true)).toBe("dusk");
    expect(sweepDirection(false)).toBe("dawn");
  });
});

describe("shouldMashCut", () => {
  it("lets two sweeps animate, hard-cuts the burst, then recovers", () => {
    expect(shouldMashCut(0)).toBe(false);
    expect(shouldMashCut(200)).toBe(false);
    expect(shouldMashCut(400)).toBe(true);
    expect(shouldMashCut(600)).toBe(true);
    // The window is keyed to the recorded sweeps, not the rejected attempts,
    // so the animation comes back once the recorded burst ages out.
    expect(shouldMashCut(1300)).toBe(false);
  });

  it("never cuts a slow, considered toggle cadence", () => {
    expect(shouldMashCut(0)).toBe(false);
    expect(shouldMashCut(1100)).toBe(false);
    expect(shouldMashCut(2200)).toBe(false);
  });
});

describe("canSweepTerminatorFront", () => {
  it("opts into clip-path on Blink and Gecko", () => {
    expect(canSweepTerminatorFront("Chrome/120.0.0.0 Safari/537.36")).toBe(true);
    expect(canSweepTerminatorFront("Firefox/121.0")).toBe(true);
    expect(canSweepTerminatorFront("Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0")).toBe(true);
  });

  it("keeps WebKit on the dissolve, including iOS branded browsers", () => {
    expect(canSweepTerminatorFront("Version/17.0 Safari/605.1.15")).toBe(false);
    expect(canSweepTerminatorFront("CriOS/120.0.0.0 Mobile/15E148 Safari/604.1")).toBe(false);
    expect(
      canSweepTerminatorFront(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/123.0.2420.70 Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
    expect(
      canSweepTerminatorFront(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/114.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
  });
});

describe("cutActiveThemeSwap", () => {
  it("skips the in-flight view transition then finishes the swap", () => {
    const skipTransition = vi.fn();
    const finish = vi.fn();
    retainActiveThemeSwap({ skipTransition, finish });
    cutActiveThemeSwap();
    expect(skipTransition).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    cutActiveThemeSwap();
    expect(skipTransition).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
  });

  it("still finishes when skipTransition throws", () => {
    const finish = vi.fn();
    retainActiveThemeSwap({
      skipTransition: () => {
        throw new Error("already finished");
      },
      finish,
    });
    cutActiveThemeSwap();
    expect(finish).toHaveBeenCalledOnce();
  });
});

describe("theme swap wiring", () => {
  it("hard-cut paths skip the in-flight view transition", () => {
    expect(useThemeSource).toContain("cutActiveThemeSwap");
    expect(useThemeSource).toContain("skipTransition");
  });

  it("keeps clip-path sweep behind data-theme-sweep so WebKit stays on the dissolve", () => {
    const css = NodeFS.readFileSync(new URL("../index.css", import.meta.url), "utf8");
    expect(css).toContain("html[data-theme-sweep]::view-transition-new(root)");
    expect(css).toContain("animation-duration: 250ms");
    expect(useThemeSource).toContain("canSweepTerminatorFront");
  });

  it("hides the live sweep veil; only the view-transition new snapshot reveals it", () => {
    const css = NodeFS.readFileSync(new URL("../index.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.theme-sweep-veil\s*\{[^}]*opacity:\s*0/s);
    expect(css).toMatch(
      /html\[data-theme-sweep\]::view-transition-new\(theme-sweep-veil\)\s*\{[^}]*theme-sweep-veil-fade/s,
    );
    expect(css).toMatch(
      /html\[data-theme-sweep\]::view-transition-new\(theme-sweep-veil\)\s*\{[^}]*--app-chrome-background/s,
    );
  });
});
