import { describe, expect, it } from "vite-plus/test";

import { cn } from "./cn";

describe("cn", () => {
  it("keeps the continuous border curve beside border colors and widths", () => {
    expect(
      cn("rounded-[14px] border-continuous", "border-[0.5px] border-chrome-glass-border"),
    ).toBe("rounded-[14px] border-continuous border-[0.5px] border-chrome-glass-border");
  });
});
