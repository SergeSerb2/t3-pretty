import { describe, expect, it } from "@effect/vitest";

import {
  cacheSavingsUsd,
  lookupRate,
  normalizeModelName,
  parseRateTable,
  priceUsage,
  type RateTable,
} from "./usagePricing.ts";

const emptyTable: RateTable = new Map();

const totals = {
  uncachedInputTokens: 1_000_000,
  cachedInputTokens: 1_000_000,
  cacheCreationTokens: 1_000_000,
  outputTokens: 1_000_000,
  reasoningTokens: 0,
};

describe("normalizeModelName", () => {
  it("strips a provider prefix and lowercases", () => {
    expect(normalizeModelName("kimi-code/k3")).toBe("k3");
    expect(normalizeModelName("Moonshot/Kimi-K3")).toBe("kimi-k3");
  });
});

describe("lookupRate", () => {
  it("maps Kimi Code CLI names to official API rates", () => {
    const k3 = lookupRate(emptyTable, "kimi-code/k3");
    expect(k3).toEqual({
      inputCostPerToken: 3e-6,
      outputCostPerToken: 1.5e-5,
      cacheReadCostPerToken: 3e-7,
      cacheCreationCostPerToken: 3e-6,
    });
    expect(lookupRate(emptyTable, "k3")).toEqual(k3);
    expect(lookupRate(emptyTable, "kimi-code/k3-256k")).toEqual(k3);
    expect(lookupRate(emptyTable, "kimi-k3")).toEqual(k3);

    expect(lookupRate(emptyTable, "kimi-code/kimi-for-coding")).toEqual({
      inputCostPerToken: 9.5e-7,
      outputCostPerToken: 4e-6,
      cacheReadCostPerToken: 1.9e-7,
      cacheCreationCostPerToken: 9.5e-7,
    });
    expect(lookupRate(emptyTable, "kimi-for-coding-highspeed")?.inputCostPerToken).toBe(1.9e-6);
    expect(lookupRate(emptyTable, "kimi-k2.6")?.cacheReadCostPerToken).toBe(1.6e-7);
    expect(lookupRate(emptyTable, "kimi-k2.5")?.outputCostPerToken).toBe(3e-6);
  });

  it("lets an explicit table entry override the official Kimi fallback", () => {
    const table: RateTable = new Map([
      [
        "k3",
        {
          inputCostPerToken: 1,
          outputCostPerToken: 2,
          cacheReadCostPerToken: 0.1,
          cacheCreationCostPerToken: 1,
        },
      ],
    ]);

    expect(lookupRate(table, "kimi-code/k3")?.inputCostPerToken).toBe(1);
  });

  it("still returns null for a model with no rate", () => {
    expect(lookupRate(emptyTable, "not-a-real-model")).toBeNull();
  });
});

describe("priceUsage", () => {
  it("charges Kimi uncached input, cache reads, cache writes, and output separately", () => {
    const priced = priceUsage(emptyTable, "k3", totals, null);

    expect(priced.costSource).toBe("modelPriced");
    expect(priced.costUsd).toBeCloseTo(3 + 0.3 + 3 + 15, 9);
    expect(cacheSavingsUsd(emptyTable, "k3", totals)).toBeCloseTo(2.7, 9);
  });

  it("does not invent a rate from a LiteLLM document that only lists other models", () => {
    const table = parseRateTable({
      "claude-fable-5": {
        input_cost_per_token: 1e-5,
        output_cost_per_token: 5e-5,
      },
    });

    expect(priceUsage(table, "mystery-model", totals, null).costSource).toBe("unpriced");
    expect(priceUsage(table, "kimi-code/kimi-for-coding", totals, null).costUsd).toBeCloseTo(
      0.95 + 0.19 + 0.95 + 4,
      9,
    );
  });

  it("rejects negative external rates and never reports negative cache savings", () => {
    const table = parseRateTable({
      "negative-model": {
        input_cost_per_token: -1,
        output_cost_per_token: 1,
      },
      "expensive-cache-model": {
        input_cost_per_token: 0.25,
        output_cost_per_token: 0.25,
        cache_read_input_token_cost: 0.5,
      },
      "oversized-rate-model": {
        input_cost_per_token: 2,
        output_cost_per_token: 1,
      },
      ["x".repeat(513)]: {
        input_cost_per_token: 1,
        output_cost_per_token: 1,
      },
    });

    expect(lookupRate(table, "negative-model")).toBeNull();
    expect(lookupRate(table, "oversized-rate-model")).toBeNull();
    expect(cacheSavingsUsd(table, "expensive-cache-model", totals)).toBe(0);
    expect(table.has("x".repeat(513))).toBe(false);
  });

  it("degrades overflowing external pricing to unpriced usage", () => {
    const table: RateTable = new Map([
      [
        "overflow-model",
        {
          inputCostPerToken: Number.MAX_VALUE,
          outputCostPerToken: Number.MAX_VALUE,
          cacheReadCostPerToken: Number.MAX_VALUE,
          cacheCreationCostPerToken: Number.MAX_VALUE,
        },
      ],
    ]);

    expect(priceUsage(table, "overflow-model", totals, null)).toEqual({
      costUsd: 0,
      costSource: "unpriced",
    });
    expect(cacheSavingsUsd(table, "overflow-model", totals)).toBe(0);
  });
});
