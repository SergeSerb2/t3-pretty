import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@expo/ui/swift-ui", () => ({
  HStack: "HStack",
  Image: "Image",
  ProgressView: "ProgressView",
  Spacer: "Spacer",
  Text: "Text",
  VStack: "VStack",
  ZStack: "ZStack",
}));

vi.mock("@expo/ui/swift-ui/modifiers", () => ({
  activityBackgroundTint: (value: unknown) => ({ activityBackgroundTint: value }),
  font: (value: unknown) => value,
  foregroundStyle: (value: unknown) => value,
  frame: (value: unknown) => value,
  layoutPriority: (value: unknown) => value,
  lineLimit: (value: unknown) => value,
  padding: (value: unknown) => value,
  progressViewStyle: (value: unknown) => ({ progressViewStyle: value }),
  resizable: (value: unknown) => value,
  tint: (value: unknown) => ({ tint: value }),
  widgetURL: (value: unknown) => ({ widgetURL: value }),
}));

vi.mock("expo-widgets", () => ({
  createLiveActivity: vi.fn((name: string, layout: unknown) => ({ layout, name })),
}));

import {
  AgentActivity,
  type AgentActivityProps,
  type AgentActivityRowProps,
} from "./AgentActivity";

function makeRow(overrides: Partial<AgentActivityRowProps>): AgentActivityRowProps {
  return {
    environmentId: "env-1",
    threadId: "thread-1",
    projectTitle: "Project",
    threadTitle: "Thread",
    modelTitle: "gpt-5.4",
    phase: "running",
    status: "Working",
    updatedAt: "2026-05-25T13:07:00.000Z",
    deepLink: "/threads/env-1/thread-1",
    ...overrides,
  };
}

const props = {
  title: "T3 Pretty",
  subtitle: "Agent work in progress",
  activeCount: 1,
  updatedAt: "2026-05-25T13:07:00.000Z",
  activities: [],
} satisfies AgentActivityProps;

const environment = {
  colorScheme: "dark",
  isLuminanceReduced: false,
} as const;

const lightEnvironment = {
  colorScheme: "light",
  isLuminanceReduced: false,
} as const;

describe("AgentActivity widget layout", () => {
  it("tints working and attention counts with the web sidebar's dark palette", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({}),
          makeRow({ threadId: "thread-2", phase: "waiting_for_approval", status: "Approval" }),
        ],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("#7dd3fc"); // sky-300: running
    expect(banner).toContain("#fcd34d"); // amber-300: waiting_for_approval
  });

  it("lets the system paint Liquid Glass instead of an opaque Live Activity fill", () => {
    const layout = AgentActivity({ ...props, activities: [makeRow({})] }, environment as never);
    expect(JSON.stringify(layout.banner)).toContain('"activityBackgroundTint":null');
  });

  it("uses a live ProgressView for in-flight work instead of a still spinner glyph", () => {
    const layout = AgentActivity({ ...props, activities: [makeRow({})] }, environment as never);
    expect(JSON.stringify(layout.compactLeading)).toContain("ProgressView");
    expect(JSON.stringify(layout.compactLeading)).toContain('"progressViewStyle":"circular"');
  });

  it("keeps a relative clock on the banner so the card still ticks between pushes", () => {
    const layout = AgentActivity({ ...props, activities: [makeRow({})] }, environment as never);
    expect(JSON.stringify(layout.banner)).toContain("2026-05-25T13:07:00.000Z");
    expect(JSON.stringify(layout.banner)).toContain('"dateStyle":"relative"');
  });

  it("renders a linear progress bar when a single working thread carries plan progress", () => {
    const layout = AgentActivity(
      { ...props, activities: [makeRow({ progress: 0.4, status: "Editing AgentActivity.tsx" })] },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain('"progressViewStyle":"linear"');
    expect(banner).toContain('"value":0.4');
    expect(banner).toContain("Editing AgentActivity.tsx");
  });

  it("keeps the simplified glass presentation to one glance line", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({ threadTitle: "Working thread" }),
          makeRow({
            threadId: "thread-2",
            threadTitle: "Blocked thread",
            phase: "waiting_for_approval",
            status: "Approval",
          }),
        ],
      },
      { ...environment, levelOfDetail: "simplified" } as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("1 approval · 1 working");
    expect(banner).not.toContain("Working thread");
    expect(banner).not.toContain("Blocked thread");
  });

  it("switches to the web sidebar's light palette when the scheme is light", () => {
    // macOS (iPhone Mirroring / Mac notification center) renders the activity
    // on a light background; the dark-material palette is illegible there.
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({}),
          makeRow({ threadId: "thread-2", phase: "waiting_for_approval", status: "Approval" }),
        ],
      },
      lightEnvironment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("#0284c7"); // sky-600: running
    expect(banner).toContain("#d97706"); // amber-600: waiting_for_approval
    expect(banner).not.toContain("#7dd3fc");
    expect(banner).not.toContain("#fcd34d");
  });

  it("leads the header with attention, then working, and lists the thread rows", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 3,
        activities: [
          makeRow({ threadTitle: "Working thread" }),
          makeRow({
            threadId: "thread-2",
            threadTitle: "Blocked thread",
            phase: "waiting_for_approval",
            status: "Approval",
          }),
          makeRow({
            threadId: "thread-3",
            threadTitle: "Another working thread",
          }),
        ],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("1 approval");
    expect(banner).toContain("2 working");
    expect(banner.indexOf("1 approval")).toBeLessThan(banner.indexOf("2 working"));
    // The rows themselves, attention first.
    expect(banner).toContain("Blocked thread");
    expect(banner).toContain("Working thread");
    expect(banner).toContain("Another working thread");
    expect(banner.indexOf("Blocked thread")).toBeLessThan(banner.indexOf("Working thread"));
  });

  it("ticks a live elapsed timer for in-flight rows that carry a turn start", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({ startedAt: "2026-05-25T13:01:30.000Z" }),
          makeRow({ threadId: "thread-2" }),
        ],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain('"dateStyle":"timer"');
    expect(banner).toContain("2026-05-25T13:01:30.000Z");
  });

  it("shows the solo running thread's elapsed timer in the compact island", () => {
    const layout = AgentActivity(
      { ...props, activities: [makeRow({ startedAt: "2026-05-25T13:01:30.000Z" })] },
      environment as never,
    );
    const trailing = JSON.stringify(layout.compactTrailing);
    expect(trailing).toContain('"dateStyle":"timer"');
    expect(trailing).toContain("2026-05-25T13:01:30.000Z");
  });

  it("names mixed attention as need you", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 3,
        activities: [
          makeRow({}),
          makeRow({ threadId: "thread-2", phase: "waiting_for_approval", status: "Approval" }),
          makeRow({ threadId: "thread-3", phase: "waiting_for_input", status: "Input" }),
        ],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("2 need you");
    expect(banner).toContain("1 working");
    expect(banner).not.toContain("1 approval");
    expect(banner).not.toContain("1 input");
  });

  it("uses the attention tint for the compact presentations when a row needs input", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({}),
          makeRow({ threadId: "thread-2", phase: "waiting_for_input", status: "Input" }),
        ],
      },
      environment as never,
    );
    expect(JSON.stringify(layout.compactLeading)).toContain("#a5b4fc"); // indigo-300
    expect(JSON.stringify(layout.compactTrailing)).toContain("Input");
    expect(JSON.stringify(layout.minimal)).toContain("#a5b4fc");
  });

  it("deep links the banner to the row that needs attention", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({}),
          makeRow({
            threadId: "thread-2",
            phase: "waiting_for_approval",
            status: "Approval",
            deepLink: "/threads/env-1/thread-2",
          }),
        ],
      },
      environment as never,
    );
    expect(JSON.stringify(layout.banner)).toContain(
      '"widgetURL":"t3code://threads/env-1/thread-2"',
    );
  });

  it("deep links the banner to the first row when nothing needs attention", () => {
    const layout = AgentActivity({ ...props, activities: [makeRow({})] }, environment as never);
    expect(JSON.stringify(layout.banner)).toContain(
      '"widgetURL":"t3code://threads/env-1/thread-1"',
    );
  });

  it("omits the deep link for unsafe paths and empty aggregates", () => {
    expect(JSON.stringify(AgentActivity(props, environment as never))).not.toContain("widgetURL");
    expect(
      JSON.stringify(
        AgentActivity(
          { ...props, activities: [makeRow({ deepLink: "//evil.example" })] },
          environment as never,
        ),
      ),
    ).not.toContain("widgetURL");
  });

  it("leads with the outcome instead of a zero count when nothing is active", () => {
    const layout = AgentActivity(
      {
        ...props,
        subtitle: "Agent work completed",
        activeCount: 0,
        activities: [makeRow({ phase: "completed", status: "Done" })],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("Done");
    expect(banner).not.toContain("0 working");
    expect(banner).not.toContain("Agent work completed");
    expect(banner).toContain("#6ee7b7"); // emerald-300 header tint
    expect(JSON.stringify(layout.compactTrailing)).toContain("Done");
    expect(JSON.stringify(layout.compactTrailing)).not.toContain("0");
    expect(JSON.stringify(layout.expandedLeading)).toContain("Done");
    expect(JSON.stringify(layout.minimal)).toContain("checkmark.circle.fill");
    expect(JSON.stringify(layout.bannerSmall)).toContain("Done");
  });

  it("reads Failed when the finished work ended in failure", () => {
    const layout = AgentActivity(
      {
        ...props,
        subtitle: "Agent work failed",
        activeCount: 0,
        activities: [makeRow({ phase: "failed", status: "Failed" })],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("Failed");
    expect(banner).not.toContain("Agent work failed");
    expect(banner).toContain("#fca5a5"); // red-300 header tint
    expect(JSON.stringify(layout.compactTrailing)).toContain("Failed");
    expect(JSON.stringify(layout.expandedLeading)).toContain("Failed");
    expect(JSON.stringify(layout.minimal)).toContain("xmark.octagon.fill");
  });

  it("lets a failure dominate mixed finished outcomes across every presentation", () => {
    const layout = AgentActivity(
      {
        ...props,
        // The server subtitle keys off the newest terminal row (completed
        // here); the layout must still read Failed everywhere so the header
        // text never disagrees with the tint, count slots, or minimal glyph.
        subtitle: "Agent work completed",
        activeCount: 0,
        activities: [
          makeRow({ phase: "completed", status: "Done" }),
          makeRow({ threadId: "thread-2", phase: "failed", status: "Failed" }),
        ],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("Failed");
    // The header outcome reads Failed; the completed row may still list its
    // own Done status below, but never ahead of the failure.
    expect(banner.indexOf("Failed")).toBeLessThan(banner.indexOf("Done"));
    expect(banner).not.toContain("Agent work completed");
    expect(banner).toContain("#fca5a5"); // red-300 header tint
    expect(JSON.stringify(layout.compactTrailing)).toContain("Failed");
    expect(JSON.stringify(layout.expandedLeading)).toContain("Failed");
    expect(JSON.stringify(layout.minimal)).toContain("xmark.octagon.fill");
  });

  it("shows a failed count beside live work without taking over the card", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 2,
        activities: [
          makeRow({}),
          makeRow({ threadId: "thread-2" }),
          makeRow({ threadId: "thread-3", phase: "failed", status: "Failed" }),
        ],
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("2 working");
    expect(banner).toContain("1 failed");
    expect(JSON.stringify(layout.compactTrailing)).toContain("2");
  });

  it("lists the first rows and collapses the rest into an overflow count", () => {
    const layout = AgentActivity(
      {
        ...props,
        activeCount: 6,
        activities: [1, 2, 3, 4, 5, 6].map((n) =>
          makeRow({ threadId: `t${n}`, threadTitle: `Thread ${n}` }),
        ),
      },
      environment as never,
    );
    const banner = JSON.stringify(layout.banner);
    expect(banner).toContain("6 working");
    expect(banner).toContain("Thread 1");
    expect(banner).toContain("Thread 3");
    expect(banner).not.toContain("Thread 4");
    expect(banner).toContain("+3 more");
    expect(JSON.stringify(layout.expandedBottom)).toContain("Thread 1");
    expect(JSON.stringify(layout.expandedBottom)).toContain("+3 more");
    expect(JSON.stringify(layout.compactTrailing)).toContain("6");
  });
});
