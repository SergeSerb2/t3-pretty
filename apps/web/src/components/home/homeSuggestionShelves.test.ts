import { describe, expect, it } from "vite-plus/test";

import {
  groupHomeSuggestionShelves,
  suggestionScrollEdges,
  suggestionShelfMask,
} from "./homeSuggestionShelves";

describe("groupHomeSuggestionShelves", () => {
  it("splits project and explore cards into labeled shelves and keeps their order", () => {
    const shelves = groupHomeSuggestionShelves([
      { kind: "explore" as const, title: "Timer" },
      { kind: "project" as const, title: "Sidebar" },
      { kind: "project" as const, title: "Heartbeats" },
      { kind: "explore" as const, title: "CLI" },
    ]);

    expect(shelves.map((shelf) => shelf.kind)).toEqual(["project", "explore"]);
    expect(shelves.map((shelf) => shelf.label)).toEqual(["Continue a project", "New ideas"]);
    expect(shelves[0]?.cards.map((card) => card.title)).toEqual(["Sidebar", "Heartbeats"]);
    expect(shelves[1]?.cards.map((card) => card.title)).toEqual(["Timer", "CLI"]);
  });

  it("omits an empty kind", () => {
    expect(
      groupHomeSuggestionShelves([{ kind: "project" as const }]).map((shelf) => shelf.kind),
    ).toEqual(["project"]);
  });
});

describe("suggestionScrollEdges", () => {
  it("reports no edges when every card fits", () => {
    expect(suggestionScrollEdges({ scrollLeft: 0, scrollWidth: 400, clientWidth: 400 })).toEqual({
      left: false,
      right: false,
    });
  });

  it("reports the forward edge at the start of an overflowing shelf", () => {
    expect(suggestionScrollEdges({ scrollLeft: 0, scrollWidth: 900, clientWidth: 400 })).toEqual({
      left: false,
      right: true,
    });
  });

  it("reports both edges in the middle and only the back edge at the end", () => {
    expect(suggestionScrollEdges({ scrollLeft: 200, scrollWidth: 900, clientWidth: 400 })).toEqual({
      left: true,
      right: true,
    });
    expect(suggestionScrollEdges({ scrollLeft: 500, scrollWidth: 900, clientWidth: 400 })).toEqual({
      left: true,
      right: false,
    });
  });
});

describe("suggestionShelfMask", () => {
  it("fades only the edges that still have cards", () => {
    expect(suggestionShelfMask({ left: false, right: false })).toBeUndefined();
    expect(suggestionShelfMask({ left: false, right: true })).toContain("to right");
    expect(suggestionShelfMask({ left: true, right: false })).toContain("transparent, #000");
    expect(suggestionShelfMask({ left: true, right: true })).toContain("calc(100% - 5.25rem)");
  });
});
