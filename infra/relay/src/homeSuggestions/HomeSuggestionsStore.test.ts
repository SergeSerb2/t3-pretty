import { describe, expect, it } from "@effect/vitest";
import { EnvironmentId, HomeSuggestionId } from "@t3tools/contracts";

import { decideHomeSuggestionsClaim, dismissFromBatch } from "./HomeSuggestionsStore.ts";

const NOW = Date.parse("2026-09-22T09:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const minutesFromNow = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const row = (overrides: Partial<Parameters<typeof decideHomeSuggestionsClaim>[0]["row"]> = {}) => ({
  generatedAt: null,
  leaseEnvironmentId: null,
  leaseExpiresAt: null,
  ...overrides,
});

describe("decideHomeSuggestionsClaim", () => {
  it("grants the first claim on an account", () => {
    expect(
      decideHomeSuggestionsClaim({ row: null, environmentId: "a", claim: "scheduled", nowMs: NOW }),
    ).toBe("granted");
  });

  it("lets a scheduled claim through only once the shared batch is a day old", () => {
    const fresh = row({ generatedAt: hoursAgo(15) });
    const stale = row({ generatedAt: hoursAgo(24) });
    expect(
      decideHomeSuggestionsClaim({
        row: fresh,
        environmentId: "a",
        claim: "scheduled",
        nowMs: NOW,
      }),
    ).toBe("none");
    expect(
      decideHomeSuggestionsClaim({
        row: stale,
        environmentId: "a",
        claim: "scheduled",
        nowMs: NOW,
      }),
    ).toBe("granted");
    expect(
      decideHomeSuggestionsClaim({ row: fresh, environmentId: "a", claim: "manual", nowMs: NOW }),
    ).toBe("granted");
  });

  it("holds every other environment while a live lease runs", () => {
    const leased = row({
      generatedAt: hoursAgo(24),
      leaseEnvironmentId: "a",
      leaseExpiresAt: minutesFromNow(10),
    });
    expect(
      decideHomeSuggestionsClaim({ row: leased, environmentId: "b", claim: "manual", nowMs: NOW }),
    ).toBe("held");
    expect(
      decideHomeSuggestionsClaim({
        row: leased,
        environmentId: "a",
        claim: "scheduled",
        nowMs: NOW,
      }),
    ).toBe("granted");
  });

  it("frees the slot when the holder's lease expires", () => {
    const expired = row({
      generatedAt: hoursAgo(24),
      leaseEnvironmentId: "a",
      leaseExpiresAt: minutesFromNow(-1),
    });
    expect(
      decideHomeSuggestionsClaim({
        row: expired,
        environmentId: "b",
        claim: "scheduled",
        nowMs: NOW,
      }),
    ).toBe("granted");
  });
});

describe("dismissFromBatch", () => {
  it("removes only the dismissed cards", () => {
    const card = (id: string) => ({
      id: HomeSuggestionId.make(id),
      kind: "explore" as const,
      projectId: null,
      environmentId: null,
      title: id,
      summary: "",
      prompt: id,
    });
    const batch = {
      generatedAt: hoursAgo(1),
      generatedByEnvironmentId: EnvironmentId.make("a"),
      suggestions: [card("one"), card("two")],
      previousTitles: ["one", "two"],
    };
    expect(
      dismissFromBatch(batch, [HomeSuggestionId.make("one")]).suggestions.map((c) => c.id),
    ).toEqual(["two"]);
  });
});
