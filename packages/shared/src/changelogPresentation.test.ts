import { describe, expect, it } from "vite-plus/test";

import type { ChangelogRelease } from "./changelogPresentation.ts";
import {
  changelogStaggerIndex,
  formatChangelogTitle,
  formatDisplayVersion,
  formatReleaseDate,
  formatUpdateSubtitle,
  presentChangelogHistory,
  presentUpdateDigest,
} from "./changelogPresentation.ts";

function release(
  version: string,
  date: string,
  items: ChangelogRelease["items"],
  headline?: string,
): ChangelogRelease {
  return headline === undefined ? { version, date, items } : { version, date, headline, items };
}

describe("formatDisplayVersion", () => {
  it("keeps the dotted prefix and drops nightly build noise", () => {
    expect(formatDisplayVersion("0.0.39-nightly.20260905.1284001654")).toBe("0.0.39");
    expect(formatDisplayVersion("v0.0.39-nightly.1.fork")).toBe("0.0.39");
    expect(formatDisplayVersion("0.0.39")).toBe("0.0.39");
  });
});

describe("formatChangelogTitle", () => {
  it("sentence-cases commit-style titles and drops feat prefixes", () => {
    expect(formatChangelogTitle("new threads land in the intended clone")).toBe(
      "New threads land in the intended clone",
    );
    expect(
      formatChangelogTitle(
        "add automations that run agents on schedules, events, webhooks, and git changes",
      ),
    ).toBe("Automations that run agents on schedules, events, webhooks, and git changes");
    expect(formatChangelogTitle("show What's New changelog dialog after updates (#41)")).toBe(
      "Show What's New changelog dialog after updates",
    );
    expect(formatChangelogTitle("restore clicks on titlebar panel toggles")).toBe(
      "Clicks on titlebar panel toggles",
    );
    expect(formatChangelogTitle("fix window snapping on tiled desktops")).toBe(
      "Window snapping on tiled desktops",
    );
  });
});

describe("formatUpdateSubtitle", () => {
  it("pairs the running version with a date or a compact range", () => {
    expect(
      formatUpdateSubtitle(
        [release("0.0.39-nightly.2", "2026-09-08", [{ kind: "fixed", title: "A" }])],
        "0.0.39-nightly.20260905.1284001654",
        "en-US",
      ),
    ).toBe("Version 0.0.39 · September 8, 2026");
    expect(
      formatUpdateSubtitle(
        [
          release("0.0.39-nightly.2", "2026-09-08", [{ kind: "fixed", title: "A" }]),
          release("0.0.39-nightly.1", "2026-09-05", [{ kind: "new", title: "B" }]),
        ],
        "0.0.39-nightly.2",
        "en-US",
      ),
    ).toBe("Version 0.0.39 · September 5–8, 2026");
  });
});

describe("presentUpdateDigest", () => {
  it("dedupes overlapping nightlies, groups by kind, and hides contributor-only titles", () => {
    const digest = presentUpdateDigest([
      release("0.0.39-nightly.2", "2026-09-08", [
        { kind: "fixed", title: "new threads land in the intended clone" },
        { kind: "fixed", title: "restore the mobile typecheck and gate it in the upstream sync" },
      ]),
      release("0.0.39-nightly.1", "2026-09-07", [
        { kind: "fixed", title: "New threads land in the intended clone" },
        {
          kind: "new",
          title: "add automations that run agents on schedules",
          description: "Run agents from a schedule, webhook, or git change.",
        },
        { kind: "improved", title: "Under-the-hood stability and maintenance" },
      ]),
    ]);

    expect(digest.groups.map((group) => group.heading)).toEqual(["New", "Fixes"]);
    expect(digest.truncated).toBe(false);
    expect(digest.groups[0]?.items).toEqual([
      {
        kind: "new",
        title: "Automations that run agents on schedules",
        sourceTitle: "add automations that run agents on schedules",
        description: "Run agents from a schedule, webhook, or git change.",
      },
    ]);
    expect(digest.groups[1]?.items.map((item) => item.title)).toEqual([
      "New threads land in the intended clone",
    ]);
  });

  it("stays empty when every note is contributor-only", () => {
    const digest = presentUpdateDigest([
      release("0.0.39-nightly.1", "2026-09-07", [
        { kind: "fixed", title: "restore the mobile typecheck and gate it in the upstream sync" },
        { kind: "improved", title: "eslint and prettier packaging step" },
      ]),
    ]);
    expect(digest.groups).toEqual([]);
  });

  it("keeps a maintenance stub only when it is the last user-facing note", () => {
    const digest = presentUpdateDigest([
      release("0.0.39-nightly.1", "2026-09-07", [
        { kind: "improved", title: "Under-the-hood stability and maintenance" },
      ]),
    ]);
    expect(digest.groups.flatMap((group) => group.items.map((item) => item.title))).toEqual([
      "Under-the-hood stability and maintenance",
    ]);
  });

  it("takes the newest headline and description even when callers pass oldest first", () => {
    const digest = presentUpdateDigest([
      release(
        "0.0.38",
        "2026-09-01",
        [{ kind: "fixed", title: "composer hover eases in" }],
        "Last month",
      ),
      release(
        "0.0.39-nightly.2",
        "2026-09-08",
        [
          {
            kind: "fixed",
            title: "composer hover eases in",
            description: "Hover no longer jumps.",
          },
        ],
        "This week",
      ),
    ]);
    expect(digest.headline).toBe("This week");
    expect(digest.groups[0]?.items).toEqual([
      {
        kind: "fixed",
        title: "Composer hover eases in",
        sourceTitle: "composer hover eases in",
        description: "Hover no longer jumps.",
      },
    ]);
  });

  it("keeps a standout headline from the newest release", () => {
    const digest = presentUpdateDigest([
      release(
        "0.0.34",
        "2026-08-10",
        [{ kind: "new", title: "World Scenery look" }],
        "Meet T3 Pretty",
      ),
    ]);
    expect(digest.headline).toBe("Meet T3 Pretty");
  });

  it("keeps the post-update digest to a short list, new items first", () => {
    const items = Array.from({ length: 11 }, (_, index) => ({
      kind: "fixed" as const,
      title: `Fix number ${index}`,
    }));
    const digest = presentUpdateDigest([
      release("0.0.39", "2026-09-08", [
        { kind: "new", title: "one skill library" },
        { kind: "improved", title: "faster switching" },
        ...items,
      ]),
    ]);
    expect(digest.truncated).toBe(true);
    expect(digest.groups.map((group) => group.heading)).toEqual(["New", "Improvements", "Fixes"]);
    expect(digest.groups.flatMap((group) => group.items).map((item) => item.title)).toEqual([
      "One skill library",
      "Faster switching",
      ...items.slice(0, 10).map((item) => formatChangelogTitle(item.title)),
    ]);
  });
});

describe("presentChangelogHistory", () => {
  it("collapses same-day nightlies and labels the day", () => {
    const days = presentChangelogHistory(
      [
        release("0.0.39-nightly.2", "2026-09-08", [
          { kind: "fixed", title: "composer hover eases in" },
        ]),
        release("0.0.39-nightly.1", "2026-09-08", [
          { kind: "fixed", title: "composer hover eases in" },
          { kind: "new", title: "one skill library with per-provider links" },
        ]),
        release("0.0.38", "2026-09-01", [{ kind: "improved", title: "faster thread switching" }]),
      ],
      "en-US",
    );

    expect(days.map((day) => day.label)).toEqual(["September 8, 2026", "September 1, 2026"]);
    expect(days[0]?.groups.map((group) => group.heading)).toEqual(["New", "Fixes"]);
    expect(days[0]?.groups.flatMap((group) => group.items.map((item) => item.title))).toEqual([
      "One skill library with per-provider links",
      "Composer hover eases in",
    ]);
  });
});

describe("formatReleaseDate", () => {
  it("returns null for garbage", () => {
    expect(formatReleaseDate("not-a-date")).toBeNull();
  });
});

describe("changelogStaggerIndex", () => {
  it("caps below-the-fold rows so they do not wait on the ones above", () => {
    const groups = [
      {
        kind: "new" as const,
        heading: "New",
        items: [{ kind: "new" as const, title: "A", sourceTitle: "A" }],
      },
      {
        kind: "fixed" as const,
        heading: "Fixes",
        items: Array.from({ length: 8 }, (_, index) => ({
          kind: "fixed" as const,
          title: `Fix ${index}`,
          sourceTitle: `Fix ${index}`,
        })),
      },
    ];
    expect(changelogStaggerIndex(groups, 0, 0)).toBe(0);
    expect(changelogStaggerIndex(groups, 1, 0)).toBe(1);
    expect(changelogStaggerIndex(groups, 1, 7)).toBe(5);
  });
});
