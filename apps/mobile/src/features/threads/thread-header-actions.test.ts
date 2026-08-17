import { describe, expect, it } from "vite-plus/test";

import {
  isCreatePullRequestQuickAction,
  resolveThreadHeaderPrPresentation,
  resolveThreadHeaderSettlePresentation,
  resolveThreadHeaderSnoozePresentation,
} from "./thread-header-actions";

describe("resolveThreadHeaderSettlePresentation", () => {
  it("settles an active supported thread", () => {
    expect(
      resolveThreadHeaderSettlePresentation({
        supported: true,
        settled: false,
        canSettle: true,
      }),
    ).toEqual({
      accessibilityLabel: "Settle thread",
      label: "Settle",
      icon: "checkmark.circle",
      disabled: false,
      action: "settle",
    });
  });

  it("un-settles an already settled thread", () => {
    expect(
      resolveThreadHeaderSettlePresentation({
        supported: true,
        settled: true,
        canSettle: false,
      }),
    ).toMatchObject({
      accessibilityLabel: "Un-settle thread",
      label: "Un-settle",
      icon: "arrow.uturn.backward",
      disabled: false,
      action: "unsettle",
    });
  });

  it("disables settle while the thread still needs attention", () => {
    expect(
      resolveThreadHeaderSettlePresentation({
        supported: true,
        settled: false,
        canSettle: false,
      }).disabled,
    ).toBe(true);
  });

  it("disables settle when the environment lacks the capability", () => {
    expect(
      resolveThreadHeaderSettlePresentation({
        supported: false,
        settled: false,
        canSettle: true,
      }).disabled,
    ).toBe(true);
  });
});

describe("resolveThreadHeaderSnoozePresentation", () => {
  it("opens the preset menu for an active snoozable thread", () => {
    expect(
      resolveThreadHeaderSnoozePresentation({
        supported: true,
        snoozed: false,
        canSnooze: true,
      }),
    ).toEqual({
      accessibilityLabel: "Snooze thread",
      label: "Snooze",
      icon: "clock",
      disabled: false,
      action: "snooze-menu",
    });
  });

  it("wakes a snoozed thread", () => {
    expect(
      resolveThreadHeaderSnoozePresentation({
        supported: true,
        snoozed: true,
        canSnooze: false,
      }),
    ).toMatchObject({
      accessibilityLabel: "Wake thread",
      label: "Wake",
      action: "wake",
      disabled: false,
    });
  });

  it("disables snooze when the thread is waiting on the user", () => {
    expect(
      resolveThreadHeaderSnoozePresentation({
        supported: true,
        snoozed: false,
        canSnooze: false,
      }).disabled,
    ).toBe(true);
  });

  it("disables snooze when the environment lacks the capability", () => {
    expect(
      resolveThreadHeaderSnoozePresentation({
        supported: false,
        snoozed: false,
        canSnooze: true,
      }).disabled,
    ).toBe(true);
  });
});

describe("isCreatePullRequestQuickAction", () => {
  it("accepts the stacked create-PR git actions", () => {
    expect(isCreatePullRequestQuickAction({ kind: "run_action", action: "create_pr" })).toBe(true);
    expect(isCreatePullRequestQuickAction({ kind: "run_action", action: "commit_push_pr" })).toBe(
      true,
    );
    expect(isCreatePullRequestQuickAction({ kind: "run_action", action: "commit" })).toBe(false);
    expect(isCreatePullRequestQuickAction({ kind: "open_pr" })).toBe(false);
  });
});

describe("resolveThreadHeaderPrPresentation", () => {
  const idleQuickAction = {
    kind: "show_hint" as const,
    label: "Commit",
    disabled: true,
    hint: "Branch is up to date. No action needed.",
  };

  it("offers view, review, and more when a pull request is open", () => {
    const presentation = resolveThreadHeaderPrPresentation({
      hasOpenPr: true,
      prNumber: 228,
      isRepo: true,
      canOpenFiles: true,
      quickAction: { kind: "open_pr", label: "View PR", disabled: false },
    });

    expect(presentation.accessibilityLabel).toBe("Pull request #228");
    expect(presentation.items.map((item) => item.id)).toEqual(["view", "review", "files", "more"]);
    expect(presentation.items[0]).toMatchObject({
      id: "view",
      label: "View PR #228",
    });
  });

  it("offers the create-PR git action when the branch is ready", () => {
    const presentation = resolveThreadHeaderPrPresentation({
      hasOpenPr: false,
      prNumber: null,
      isRepo: true,
      canOpenFiles: true,
      quickAction: {
        kind: "run_action",
        action: "commit_push_pr",
        label: "Commit, push & PR",
        disabled: false,
      },
    });

    expect(presentation.items[0]).toMatchObject({
      id: "create",
      label: "Commit, push & PR",
      disabled: false,
    });
  });

  it("disables create when the branch is not ready and still offers review and more", () => {
    const presentation = resolveThreadHeaderPrPresentation({
      hasOpenPr: false,
      prNumber: null,
      isRepo: true,
      canOpenFiles: true,
      quickAction: idleQuickAction,
    });

    expect(presentation.items[0]).toMatchObject({
      id: "create",
      label: "Create pull request",
      disabled: true,
      description: idleQuickAction.hint,
    });
    expect(presentation.items.map((item) => item.id)).toEqual([
      "create",
      "review",
      "files",
      "more",
    ]);
  });

  it("disables review when the workspace is not a git repo", () => {
    const presentation = resolveThreadHeaderPrPresentation({
      hasOpenPr: false,
      prNumber: null,
      isRepo: false,
      canOpenFiles: false,
      quickAction: idleQuickAction,
    });

    expect(presentation.items.find((item) => item.id === "review")?.disabled).toBe(true);
    expect(presentation.items.find((item) => item.id === "files")?.disabled).toBe(true);
  });
});
