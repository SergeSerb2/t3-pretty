import {
  HOME_SUGGESTIONS_EXPLORE_COUNT,
  HOME_SUGGESTIONS_PROJECT_COUNT,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationProjectShell,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  HOME_SUGGESTIONS_MAX_THREADS,
  HOME_SUGGESTIONS_MAX_THREADS_PER_PROJECT,
  HOME_SUGGESTIONS_TITLE_MEMORY,
  buildHomeSuggestionsDigest,
  mapGeneratedSuggestions,
  nextHomeSuggestionsRunAt,
  rememberTitles,
  selectDigestThreads,
} from "./HomeSuggestionsContext.ts";

const NOW = Date.parse("2026-09-21T12:00:00.000Z");

function makeProject(id: string, overrides: Partial<OrchestrationProjectShell> = {}) {
  return {
    id: ProjectId.make(id),
    title: id,
    workspaceRoot: `/home/dev/src/${id}`,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  } satisfies OrchestrationProjectShell;
}

function makeThread(
  id: string,
  projectId: string,
  updatedAt: string,
  overrides: Partial<OrchestrationThreadShell> = {},
): OrchestrationThreadShell {
  return {
    id: ThreadId.make(id),
    projectId: ProjectId.make(projectId),
    title: `Thread ${id}`,
    enabledSkillIds: [],
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-astra" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

describe("selectDigestThreads", () => {
  it("takes the newest live threads and caps each project", () => {
    const projects = [makeProject("alpha"), makeProject("beta")];
    const alpha = Array.from({ length: 12 }, (_, index) =>
      makeThread(
        `a${index}`,
        "alpha",
        `2026-09-${String(20 - index).padStart(2, "0")}T00:00:00.000Z`,
      ),
    );
    const beta = [makeThread("b0", "beta", "2026-09-10T00:00:00.000Z")];
    const archived = makeThread("archived", "beta", "2026-09-21T00:00:00.000Z", {
      archivedAt: "2026-09-21T01:00:00.000Z",
    });
    const orphan = makeThread("orphan", "gone", "2026-09-21T00:00:00.000Z");

    const selected = selectDigestThreads([...beta, archived, orphan, ...alpha], projects);

    expect(selected[0]?.id).toBe("a0");
    expect(selected.filter((thread) => thread.projectId === "alpha")).toHaveLength(
      HOME_SUGGESTIONS_MAX_THREADS_PER_PROJECT,
    );
    expect(selected.map((thread) => thread.id)).toContain("b0");
    expect(selected.map((thread) => thread.id)).not.toContain("archived");
    expect(selected.map((thread) => thread.id)).not.toContain("orphan");
  });

  it("stops at the overall cap", () => {
    const projects = Array.from({ length: 10 }, (_, index) => makeProject(`p${index}`));
    const threads = projects.flatMap((project) =>
      Array.from({ length: 6 }, (_, index) =>
        makeThread(`${project.id}-${index}`, project.id, "2026-09-20T00:00:00.000Z"),
      ),
    );
    expect(selectDigestThreads(threads, projects)).toHaveLength(HOME_SUGGESTIONS_MAX_THREADS);
  });
});

describe("buildHomeSuggestionsDigest", () => {
  it("keys projects by recent activity and strips hidden prompt blocks", () => {
    const projects = [makeProject("quiet"), makeProject("busy")];
    const digest = buildHomeSuggestionsDigest({
      projects,
      threads: [
        {
          shell: makeThread("t1", "busy", "2026-09-21T09:00:00.000Z", {
            title: "Fix the flaky login test",
            latestTurn: {
              turnId: "turn-1" as never,
              state: "completed",
              requestedAt: "2026-09-21T08:00:00.000Z",
              startedAt: null,
              completedAt: null,
              assistantMessageId: null,
            },
          }),
          messages: [
            {
              role: "user",
              text: 'Make login.test.ts pass\n\n<create_pull_request_instructions source="t3-auto-pr">\nsecret\n</create_pull_request_instructions>',
            },
            { role: "reasoning", text: "thinking" },
            { role: "assistant", text: "Done, the retry was racing the cookie write." },
          ],
        },
      ],
      nowMs: NOW,
      timeZone: "UTC",
    });

    expect(digest.projectsByKey.get("P1")).toBe("busy");
    expect(digest.projectsByKey.get("P2")).toBe("quiet");
    expect(digest.context).toContain("## P1: busy (folder: busy)");
    expect(digest.context).toContain("Fix the flaky login test (today, last turn completed)");
    expect(digest.context).toContain("Asked: Make login.test.ts pass");
    expect(digest.context).not.toContain("secret");
    expect(digest.context).toContain("Outcome: Done, the retry was racing the cookie write.");
    expect(digest.context).toContain("## P2: quiet (folder: quiet)\nNo recent threads.");
  });
});

describe("buildHomeSuggestionsDigest day labels", () => {
  it("counts days on the schedule's calendar rather than UTC", () => {
    // 23:30 local in Berlin (21:30Z) on the 20th, viewed at 01:00 local on the 21st (23:00Z on the 20th).
    const digest = buildHomeSuggestionsDigest({
      projects: [makeProject("p")],
      threads: [
        { shell: makeThread("late", "p", "2026-09-20T21:30:00.000Z"), messages: [] },
        { shell: makeThread("older", "p", "2026-09-17T21:30:00.000Z"), messages: [] },
      ],
      nowMs: Date.parse("2026-09-20T23:00:00.000Z"),
      timeZone: "Europe/Berlin",
    });
    expect(digest.context).toContain("Thread late (yesterday,");
    expect(digest.context).toContain("Thread older (4 days ago,");
  });
});

describe("mapGeneratedSuggestions", () => {
  const projectsByKey = new Map([["P1", ProjectId.make("alpha")]]);
  const card = (index: number, kind: "project" | "explore", projectKey = "P1") => ({
    kind,
    projectKey,
    title: `Card ${index}`,
    summary: "why",
    prompt: `Do thing ${index}`,
  });

  it("resolves project keys, demotes unknown projects, and keeps the mix", () => {
    const generated = [
      ...Array.from({ length: HOME_SUGGESTIONS_PROJECT_COUNT + 2 }, (_, index) =>
        card(index, "project"),
      ),
      card(90, "project", "P9"),
      ...Array.from({ length: HOME_SUGGESTIONS_EXPLORE_COUNT + 2 }, (_, index) =>
        card(100 + index, "explore", ""),
      ),
    ];
    const cards = mapGeneratedSuggestions({
      generated,
      projectsByKey,
      makeId: (index) => `batch:${index}`,
    });

    const projectCards = cards.filter((entry) => entry.kind === "project");
    const exploreCards = cards.filter((entry) => entry.kind === "explore");
    expect(projectCards).toHaveLength(HOME_SUGGESTIONS_PROJECT_COUNT);
    expect(projectCards.every((entry) => entry.projectId === "alpha")).toBe(true);
    expect(exploreCards).toHaveLength(HOME_SUGGESTIONS_EXPLORE_COUNT);
    // The unknown-project card became the first explore card.
    expect(exploreCards[0]?.title).toBe("Card 90");
    expect(exploreCards[0]?.projectId).toBeNull();
    expect(cards.map((entry) => entry.id)).toEqual(cards.map((_, index) => `batch:${index}`));
  });

  it("drops empty and duplicate cards", () => {
    const cards = mapGeneratedSuggestions({
      generated: [
        { ...card(1, "project"), title: "  " },
        { ...card(2, "project"), prompt: "" },
        card(3, "project"),
        { ...card(4, "project"), title: "card 3" },
      ],
      projectsByKey,
      makeId: String,
    });
    expect(cards.map((entry) => entry.title)).toEqual(["Card 3"]);
  });
});

describe("rememberTitles", () => {
  it("puts the new batch first and stays bounded", () => {
    const previous = Array.from({ length: HOME_SUGGESTIONS_TITLE_MEMORY }, (_, i) => `old ${i}`);
    const batch = mapGeneratedSuggestions({
      generated: [{ kind: "explore", projectKey: "", title: "New", summary: "", prompt: "go" }],
      projectsByKey: new Map(),
      makeId: String,
    });
    const remembered = rememberTitles(previous, batch);
    expect(remembered[0]).toBe("New");
    expect(remembered).toHaveLength(HOME_SUGGESTIONS_TITLE_MEMORY);
    expect(remembered.at(-1)).toBe(`old ${HOME_SUGGESTIONS_TITLE_MEMORY - 2}`);
  });
});

describe("nextHomeSuggestionsRunAt", () => {
  it("returns today's instant when it is still ahead", () => {
    const next = nextHomeSuggestionsRunAt({
      time: "09:00",
      afterMs: Date.parse("2026-09-21T06:30:00.000Z"),
      timeZone: "Europe/Berlin",
    });
    // 09:00 CEST is 07:00 UTC.
    expect(DateTime.formatIso(DateTime.makeUnsafe(next))).toBe("2026-09-21T07:00:00.000Z");
  });

  it("rolls to tomorrow once today's instant has passed", () => {
    const next = nextHomeSuggestionsRunAt({
      time: "09:00",
      afterMs: Date.parse("2026-09-21T07:00:00.000Z"),
      timeZone: "Europe/Berlin",
    });
    expect(DateTime.formatIso(DateTime.makeUnsafe(next))).toBe("2026-09-22T07:00:00.000Z");
  });

  it("falls back to UTC for an unknown zone", () => {
    const next = nextHomeSuggestionsRunAt({
      time: "23:30",
      afterMs: Date.parse("2026-09-21T23:00:00.000Z"),
      timeZone: "Mars/Olympus",
    });
    expect(DateTime.formatIso(DateTime.makeUnsafe(next))).toBe("2026-09-21T23:30:00.000Z");
  });
});
