import { describe, expect, it } from "vite-plus/test";

import {
  buildHomeStatusBriefing,
  countDistinctHomeScopeProjects,
  deriveHomeStatusCounts,
  homeBriefingScopeLabel,
} from "./homeStatusBriefing";

describe("Home status briefing", () => {
  it("prioritizes work that needs attention", () => {
    const counts = deriveHomeStatusCounts({
      liveStatuses: ["approval", "input", "failed", "working", "ready"],
      queued: 2,
      snoozed: 1,
      settled: 8,
    });

    expect(counts).toEqual({
      live: 5,
      needsAttention: 3,
      inMotion: 1,
      ready: 1,
      queued: 2,
      snoozed: 1,
      settled: 8,
    });
    expect(buildHomeStatusBriefing(counts, "")).toMatchObject({
      title: "3 threads need your attention",
      sectionLabel: "Live work",
      total: 16,
    });
  });

  it("uses motion, queue, and quiet-state copy in priority order", () => {
    expect(
      buildHomeStatusBriefing(
        deriveHomeStatusCounts({
          liveStatuses: ["working", "ready"],
          queued: 3,
          snoozed: 0,
          settled: 0,
        }),
        "",
      ).title,
    ).toBe("1 thread in motion");

    expect(
      buildHomeStatusBriefing(
        deriveHomeStatusCounts({ liveStatuses: [], queued: 1, snoozed: 0, settled: 0 }),
        "",
      ).title,
    ).toBe("1 task waiting to send");

    expect(
      buildHomeStatusBriefing(
        deriveHomeStatusCounts({ liveStatuses: [], queued: 0, snoozed: 0, settled: 4 }),
        "",
      ).title,
    ).toBe("All clear");
  });

  it("summarizes filtered work across live and history", () => {
    const briefing = buildHomeStatusBriefing(
      deriveHomeStatusCounts({
        liveStatuses: ["working"],
        queued: 1,
        snoozed: 2,
        settled: 3,
      }),
      "projection",
    );

    expect(briefing).toMatchObject({
      title: "7 matches",
      detail: "Showing results for “projection” across live work and history.",
      sectionLabel: "Live matches",
      total: 7,
    });
  });

  it("withholds partial totals while a filtered search is loading", () => {
    const briefing = buildHomeStatusBriefing(
      deriveHomeStatusCounts({ liveStatuses: [], queued: 0, snoozed: 0, settled: 0 }),
      "projection",
      { searchPending: true },
    );

    expect(briefing).toMatchObject({
      title: "Searching your workspace",
      isPending: true,
      total: null,
    });
  });

  it("counts distinct projects represented only by queued or live work", () => {
    expect(
      countDistinctHomeScopeProjects({
        catalogProjectKeys: ["env-a:project-a"],
        workProjectKeys: ["env-a:project-a", "env-b:project-b"],
      }),
    ).toBe(2);
  });

  it("describes the current project or environment scope without redundant chrome", () => {
    expect(
      homeBriefingScopeLabel({
        connectedEnvironmentCount: 3,
        projectCount: 8,
        selectedEnvironmentLabel: null,
        selectedProjectTitle: null,
      }),
    ).toBe("3 connected environments · 8 projects");

    expect(
      homeBriefingScopeLabel({
        connectedEnvironmentCount: 3,
        projectCount: 2,
        selectedEnvironmentLabel: "Studio Mac",
        selectedProjectTitle: null,
      }),
    ).toBe("Studio Mac · 2 projects");

    expect(
      homeBriefingScopeLabel({
        connectedEnvironmentCount: 3,
        projectCount: 1,
        selectedEnvironmentLabel: "Studio Mac",
        selectedProjectTitle: "T3 Pretty",
      }),
    ).toBe("T3 Pretty");
  });
});
