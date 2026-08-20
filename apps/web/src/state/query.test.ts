import * as Cause from "effect/Cause";
import { describe, expect, it } from "vite-plus/test";

import { formatEnvironmentQueryError } from "./query";

describe("formatEnvironmentQueryError", () => {
  it("uses the message of a typed failure", () => {
    expect(formatEnvironmentQueryError(Cause.fail(new Error("boom")))).toBe("boom");
  });

  it("surfaces string defects instead of the generic fallback", () => {
    // An older server answers an unknown RPC with `Exit.die("Unknown request
    // tag: ...")`; that defect must reach the user.
    expect(formatEnvironmentQueryError(Cause.die("Unknown request tag: example.get"))).toBe(
      "Unknown request tag: example.get",
    );
  });

  it("falls back when the squashed value carries no message", () => {
    expect(formatEnvironmentQueryError(Cause.fail(new Error("")))).toBe(
      "The environment request failed.",
    );
    expect(formatEnvironmentQueryError(Cause.die({ reason: "unknown" }))).toBe(
      "The environment request failed.",
    );
  });
});
