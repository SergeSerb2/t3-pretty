import { describe, expect, it } from "@effect/vitest";

import { BUILT_IN_DRIVERS } from "./builtInDrivers.ts";

describe("builtInDrivers", () => {
  it("does not ship a Kimi driver that would call makeKimiEnvironment at boot", () => {
    expect(BUILT_IN_DRIVERS.map((driver) => driver.driverKind)).not.toContain("kimi");
  });
});
