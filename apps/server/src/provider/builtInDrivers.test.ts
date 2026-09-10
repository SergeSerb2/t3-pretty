// @effect-diagnostics nodeBuiltinImport:off — this suite asserts the Kimi
// driver modules were deleted from disk, not that a virtual FS can see them.
import { existsSync } from "node:fs";
import * as NodePath from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@effect/vitest";

import { BUILT_IN_DRIVERS } from "./builtInDrivers.ts";

const providerRoot = NodePath.dirname(fileURLToPath(import.meta.url));

describe("builtInDrivers", () => {
  it("does not ship a Kimi driver that would call makeKimiEnvironment at boot", () => {
    expect(BUILT_IN_DRIVERS.map((driver) => driver.driverKind)).not.toContain("kimi");
    expect(existsSync(NodePath.join(providerRoot, "Drivers/KimiDriver.ts"))).toBe(false);
    expect(existsSync(NodePath.join(providerRoot, "Drivers/KimiHome.ts"))).toBe(false);
  });
});
