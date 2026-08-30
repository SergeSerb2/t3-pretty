import { describe, expect, it } from "@effect/vitest";

import { terminalInputDebugDetails } from "./terminalDebugLog";

describe("terminalInputDebugDetails", () => {
  it("retains a short input's diagnostic code points", () => {
    expect(terminalInputDebugDetails("A\u001b")).toEqual({
      utf16Length: 2,
      codePointPrefix: [65, 27],
      truncated: false,
    });
  });

  it("does not materialize an arbitrarily large pasted input in debug details", () => {
    const details = terminalInputDebugDetails("x".repeat(100_000));

    expect(details.utf16Length).toBe(100_000);
    expect(details.codePointPrefix).toHaveLength(32);
    expect(details.truncated).toBe(true);
  });
});
