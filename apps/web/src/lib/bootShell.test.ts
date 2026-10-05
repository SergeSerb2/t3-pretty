import { describe, expect, it } from "vite-plus/test";

import { BOOT_SHELL_ENTER_MS, bootShellRevealDelayMs } from "./bootShell";

describe("boot shell reveal delay", () => {
  it("holds a fast load until the lockup has settled", () => {
    expect(bootShellRevealDelayMs(80, false)).toBe(BOOT_SHELL_ENTER_MS - 80);
  });

  it("dissolves immediately once the entrance has already played", () => {
    expect(bootShellRevealDelayMs(BOOT_SHELL_ENTER_MS, false)).toBe(0);
    expect(bootShellRevealDelayMs(4_000, false)).toBe(0);
  });

  it("never waits when the user prefers reduced motion", () => {
    expect(bootShellRevealDelayMs(40, true)).toBe(0);
  });
});
