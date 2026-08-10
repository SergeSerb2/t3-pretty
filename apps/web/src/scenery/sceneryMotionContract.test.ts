/**
 * Rebase tripwire for the motion layer's structural assumptions about
 * upstream markup. motion.css and SceneryMotion.tsx target these hooks by
 * selector only; if a nightly rebase renames an attribute, an aria-label,
 * or one of the pinned class strings, an animation (or an orb slot)
 * silently stops appearing. This test makes that failure loud.
 */
import { describe, expect, it } from "vite-plus/test";

import chatViewSource from "../components/ChatView.tsx?raw";
import changedFilesSource from "../components/chat/ChangedFilesTree.tsx?raw";
import approvalPanelSource from "../components/chat/ComposerPendingApprovalPanel.tsx?raw";
import primaryActionsSource from "../components/chat/ComposerPrimaryActions.tsx?raw";
import draftHeroSource from "../components/chat/DraftHeroHeadline.tsx?raw";
import messagesTimelineSource from "../components/chat/MessagesTimeline.tsx?raw";
import providerBannerSource from "../components/chat/ProviderStatusBanner.tsx?raw";
import sidebarSource from "../components/Sidebar.tsx?raw";
import alertSource from "../components/ui/alert.tsx?raw";
import motionDriverSource from "./SceneryMotion.tsx?raw";
import motionStylesSource from "./motion.css?raw";

describe("row arrival contract with the messages timeline", () => {
  it("row wrappers still carry data-timeline-root", () => {
    expect(messagesTimelineSource).toContain('data-timeline-root="true"');
  });

  it("rows still expose id, kind and role attributes", () => {
    expect(messagesTimelineSource).toContain("data-timeline-row-id={row.id}");
    expect(messagesTimelineSource).toContain("data-timeline-row-kind={row.kind}");
    expect(messagesTimelineSource).toContain("data-message-role");
  });
});

describe("working-row orb contract", () => {
  it("the working row still renders the pulse-dot cluster the orb replaces", () => {
    expect(messagesTimelineSource).toContain('"working"');
    expect(messagesTimelineSource).toContain("inline-flex items-center gap-[3px]");
    expect(messagesTimelineSource).toContain("animate-status-pulse");
  });

  it("tool rows still expose the heading span the orb verb is read from", () => {
    expect(messagesTimelineSource).toContain("min-w-0 shrink truncate");
  });

  it("never clones the transient working row into a fixed-position exit ghost", () => {
    expect(motionDriverSource).not.toContain("workingRow.cloneNode");
    expect(motionDriverSource).not.toContain("scenery-ghost-exit");
    expect(motionStylesSource).not.toContain("scenery-ghost-exit");
  });
});

describe("tool card disclosure contract", () => {
  it("the expanded body still mounts under the ms-7 indent wrapper", () => {
    expect(messagesTimelineSource).toContain("mt-1 ms-7 cursor-default border-s");
  });

  it("status verdict icons still live in the gap-px indicator cluster", () => {
    expect(messagesTimelineSource).toContain("gap-px text-icon-muted");
  });
});

describe("chat view contract", () => {
  it("the scroll-to-end pill still carries its aria-label", () => {
    expect(chatViewSource).toContain('aria-label="Scroll to end"');
  });

  it("the composer overlay (hero headline host) still carries its attribute", () => {
    expect(chatViewSource).toContain('data-chat-composer-overlay="true"');
  });
});

describe("composer contract", () => {
  it("send and stop buttons still carry the aria-labels the press feedback keys on", () => {
    expect(primaryActionsSource).toContain('"Send message"');
    expect(primaryActionsSource).toContain('aria-label="Stop generation"');
  });

  it("the approval panel still exposes data-approval-detail", () => {
    expect(approvalPanelSource).toContain("data-approval-detail");
  });
});

describe("banner contract", () => {
  it("alerts still expose data-slot=alert", () => {
    expect(alertSource).toContain('data-slot="alert"');
  });

  it("the provider status banner still uses role=alert", () => {
    expect(providerBannerSource).toContain('role="alert"');
  });
});

describe("hero and sidebar contract", () => {
  it("the draft hero still renders an h1 headline", () => {
    expect(draftHeroSource).toContain("<h1");
  });

  it("the new-thread button still carries its aria-label", () => {
    expect(sidebarSource).toContain('aria-label="New thread"');
  });

  it("working sidebar rows still mark themselves with CircleDashedIcon", () => {
    expect(sidebarSource).toContain("data-thread-item");
    expect(sidebarSource).toContain("CircleDashedIcon");
  });
});

describe("changed-files card contract", () => {
  it("the card still exposes data-changed-files-state", () => {
    expect(changedFilesSource).toContain("data-changed-files-state");
  });
});
