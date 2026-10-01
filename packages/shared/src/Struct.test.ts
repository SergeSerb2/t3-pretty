import { describe, expect, it } from "vite-plus/test";

import { deepMerge } from "./Struct.ts";

describe("deepMerge", () => {
  it("keeps JSON __proto__ keys as inert own properties", () => {
    const patch = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    const merged = deepMerge<Record<string, unknown>>({ existing: true }, patch);

    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(Object.hasOwn(merged, "__proto__")).toBe(true);
    expect(merged["__proto__"]).toEqual({ polluted: true });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("replaces arrays rather than converting them to records", () => {
    expect(deepMerge({ values: ["old"] }, { values: ["new"] })).toEqual({
      values: ["new"],
    });
  });
});
