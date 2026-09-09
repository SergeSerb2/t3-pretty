import {
  type OrchestrationThreadShell,
  ProjectId,
  ProviderInstanceId,
  type PullRequestSummary,
  ThreadId,
  type VcsStatusResult,
} from "@t3tools/contracts";
import { effectiveSettled } from "@t3tools/client-runtime/state/thread-settled";
import { describe, expect, it } from "@effect/vitest";
import {
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
} from "lucide-react";

import {
  automatedReviewIndicator,
  ChangeRequestStatusIcon,
  prStatusIndicator,
  settledPrHoverColorClass,
  THREAD_CHANGE_REQUEST_SNAPSHOT_LIMIT,
  threadChangeRequestSnapshotsEqual,
  threadChangeRequestSnapshotsAtom,
  type ThreadChangeRequestSnapshot,
  updateThreadChangeRequestSnapshots,
describe("prStatusIndicator", () => {
  it("formats PR tooltips with number, uppercase status, and title", () => {
    expect(prStatusIndicator(status().pr, undefined)).toMatchObject({
      tooltip: "PR #42 - Open: PR branch",
      tooltipLead: "PR #42 - Open",
      tooltipTitle: "PR branch",
    });
  });

  it("uses red for closed pull requests", () => {
    const closedPr = status().pr;
    if (!closedPr) throw new Error("Expected pull request fixture");

    expect(prStatusIndicator({ ...closedPr, state: "closed" }, undefined)?.colorClass).toContain(
      "text-red-600",
    );
  });

  it("includes the public Codex state in the tooltip", () => {
    const pr = status().pr;
    if (!pr) throw new Error("Expected pull request fixture");

    expect(
      prStatusIndicator(
        { ...pr, automatedReview: { provider: "codex", state: "reviewing" } },
        undefined,
      ),
    ).toMatchObject({
      tooltip: "PR #42 - Open: PR branch. Auto review running.",
      automatedReview: {
        state: "reviewing",
        shortLabel: "Running",
      },
    });
  });

  it("uses gray and draft wording for draft pull requests", () => {
    const draftPr = status().pr;
    if (!draftPr) throw new Error("Expected pull request fixture");

    expect(prStatusIndicator({ ...draftPr, isDraft: true }, undefined)).toMatchObject({
      label: "PR draft",
      colorClass: "text-zinc-500 dark:text-zinc-400/80",
      tooltipLead: "PR #42 - Draft",
    });
  });
});

describe("automatedReviewIndicator", () => {
  it("distinguishes a checked PR with no public signal from an unsupported server", () => {
    expect(automatedReviewIndicator(null)).toMatchObject({
      state: "no_signal",
      shortLabel: "No signal",
    });
    expect(automatedReviewIndicator(undefined)).toBeNull();
  });
});

describe("settledPrHoverColorClass", () => {
  it.each([
    ["open", "text-emerald-600"],
    ["merged", "text-violet-600"],
    ["closed", "text-red-600"],
  ] as const)("restores the %s pull request color on row hover", (state, colorClass) => {
    expect(settledPrHoverColorClass(state)).toContain(`group-hover/v2-row:${colorClass}`);
  });

  it("keeps draft pull requests gray on row hover", () => {
    expect(settledPrHoverColorClass("open", true)).toContain("group-hover/v2-row:text-zinc-500");
  });
});
