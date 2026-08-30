// @effect-diagnostics nodeBuiltinImport:off - stylesheet contract reads source files from disk.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const indexCss = NodeFS.readFileSync(new URL("../../index.css", import.meta.url), "utf8");
const sidebarTrigger = NodeFS.readFileSync(new URL("./sidebar.tsx", import.meta.url), "utf8");
const sidebarChrome = NodeFS.readFileSync(
  new URL("../sidebar/SidebarChrome.tsx", import.meta.url),
  "utf8",
);
const updatePill = NodeFS.readFileSync(
  new URL("../sidebar/SidebarUpdatePill.tsx", import.meta.url),
  "utf8",
);
const iconMotion = indexCss.slice(
  indexCss.indexOf("/* Animate UI's icon catalog"),
  indexCss.indexOf("/* On mobile, morph the expanded hero composer"),
);
const settleKeyframes = indexCss.slice(
  indexCss.indexOf("@keyframes desktop-update-check-settle"),
  indexCss.indexOf(
    "}",
    indexCss.indexOf("100%", indexCss.indexOf("@keyframes desktop-update-check-settle")),
  ) + 1,
);
const settleEnd = settleKeyframes.slice(settleKeyframes.indexOf("100%"));
const spinSettleRotateRule = iconMotion.slice(
  iconMotion.indexOf(
    "svg.lucide-refresh-cw:is(.animate-spin, .animate-desktop-update-check-settle)",
  ),
  iconMotion.indexOf(
    "}",
    iconMotion.indexOf(
      "svg.lucide-refresh-cw:is(.animate-spin, .animate-desktop-update-check-settle)",
    ),
  ) + 1,
);

describe("animated icon boundaries", () => {
  it("keeps motion reversible, reduced-motion safe, and scoped to controls", () => {
    expect(iconMotion).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(iconMotion).toContain("@media (hover: hover) and (pointer: fine)");
    expect(iconMotion).toContain("[data-animate-ui-icons]");
    expect(iconMotion).toContain('[data-slot="toggle"]');
    expect(iconMotion).toContain(".lucide-panel-bottom");
    expect(iconMotion).toContain(".lucide-git-pull-request");
    expect(iconMotion).not.toContain("a[href]");
    expect(iconMotion).not.toContain('[data-slot="tooltip-trigger"]');
    expect(iconMotion).not.toContain("animation:");
    expect(iconMotion).not.toContain("360deg");
  });

  it("spins from a snapshotted click pose and settles at rest", () => {
    expect(spinSettleRotateRule).toContain("rotate: var(--refresh-cw-from, 0deg)");
    expect(iconMotion).not.toContain("--refresh-cw-rest");
    expect(settleKeyframes).toContain("rotate: var(--refresh-cw-from, 0deg)");
    expect(settleKeyframes).toContain("calc(var(--refresh-cw-from, 0deg) + 18deg)");
    expect(settleEnd).toContain("rotate: 0deg");
    expect(settleEnd).not.toContain("--refresh-cw-from");
    expect(settleKeyframes).not.toContain("--refresh-cw-tilt");
    expect(settleKeyframes).not.toContain("transform:");
  });

  it("opts tooltip-wrapped sidebar chrome into icon motion", () => {
    expect(sidebarTrigger).toContain("data-animate-ui-icons");
    expect(sidebarChrome).toContain("data-animate-ui-icons");
    expect(updatePill).toContain("data-animate-ui-icons");
    expect(updatePill).toContain("desktopUpdateCheckSpinFrom");
    expect(updatePill).toContain("--refresh-cw-from");
  });

  it("keeps the refresh icon mounted through its settle-to-rest transition", () => {
    expect(updatePill).toContain("key={checkAnimationKey}");
  });
});
