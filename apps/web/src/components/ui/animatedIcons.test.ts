// @effect-diagnostics nodeBuiltinImport:off - stylesheet contract reads source files from disk.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const indexCss = NodeFS.readFileSync(new URL("../../index.css", import.meta.url), "utf8");
const updatePill = NodeFS.readFileSync(
  new URL("../sidebar/SidebarUpdatePill.tsx", import.meta.url),
  "utf8",
);
const iconMotion = indexCss.slice(
  indexCss.indexOf("/* Animate UI's icon catalog"),
  indexCss.indexOf("/* On mobile, morph the expanded hero composer"),
);

describe("animated icon boundaries", () => {
  it("keeps motion reversible, reduced-motion safe, and scoped to controls", () => {
    expect(iconMotion).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(iconMotion).toContain("@media (hover: hover) and (pointer: fine)");
    expect(iconMotion).toContain("[data-animate-ui-icons]");
    expect(iconMotion).not.toContain("a[href]");
    expect(iconMotion).not.toContain("animation:");
    expect(iconMotion).not.toContain("360deg");
  });

  it("leaves the sidebar update control out of the opt-in boundary", () => {
    expect(updatePill).not.toContain("data-animate-ui-icons");
  });
});
