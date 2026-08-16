// @effect-diagnostics nodeBuiltinImport:off - Module-scope raw CSS fixture loading has no Effect test scope.
/**
 * Rebase tripwire for the motion layer's structural assumptions about
 * upstream markup. motion.css and SceneryMotion.tsx target these hooks by
 * selector only; if a nightly rebase renames an attribute, an aria-label,
 * or one of the pinned class strings, an animation silently stops appearing.
 * This test makes that failure loud.
 */
import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

import agentsPanelSource from "../components/AgentsPanel.tsx?raw";
import animatedHeightSource from "../components/AnimatedHeight.tsx?raw";
import pairingRouteSource from "../components/auth/PairingRouteSurface.tsx?raw";
import chatViewSource from "../components/ChatView.tsx?raw";
import changedFilesSource from "../components/chat/ChangedFilesTree.tsx?raw";
import chatComposerSource from "../components/chat/ChatComposer.tsx?raw";
import pendingUserInputSource from "../components/chat/ComposerPendingUserInputPanel.tsx?raw";
import primaryActionsSource from "../components/chat/ComposerPrimaryActions.tsx?raw";
import draftHeroSource from "../components/chat/DraftHeroHeadline.tsx?raw";
import expandedImageSource from "../components/chat/ExpandedImageDialog.tsx?raw";
import messagesTimelineSource from "../components/chat/MessagesTimeline.tsx?raw";
import providerBannerSource from "../components/chat/ProviderStatusBanner.tsx?raw";
import threadSyncPillSource from "../components/chat/ThreadSyncStatusPill.tsx?raw";
import gitActionsSource from "../components/GitActionsControl.tsx?raw";
import noActiveThreadSource from "../components/NoActiveThreadState.tsx?raw";
import quitHoldSource from "../components/QuitHoldOverlay.tsx?raw";
import rightPanelTabsSource from "../components/RightPanelTabs.tsx?raw";
import connectionsSettingsSource from "../components/settings/ConnectionsSettings.tsx?raw";
import settingsLayoutSource from "../components/settings/settingsLayout.tsx?raw";
import themeEditorSource from "../components/settings/ThemeEditorPanel.tsx?raw";
import sidebarSource from "../components/Sidebar.tsx?raw";
import providerUpdatePillSource from "../components/sidebar/SidebarProviderUpdatePill.tsx?raw";
import alertSource from "../components/ui/alert.tsx?raw";
import checkboxSource from "../components/ui/checkbox.tsx?raw";
import dialogSource from "../components/ui/dialog.tsx?raw";
import emptySource from "../components/ui/empty.tsx?raw";
import radioGroupSource from "../components/ui/radio-group.tsx?raw";
import uiSidebarSource from "../components/ui/sidebar.tsx?raw";
import toastSource from "../components/ui/toast.tsx?raw";
import whatsNewSource from "../components/WhatsNewDialog.tsx?raw";
import chatIndexRouteSource from "../routes/_chat.index.tsx?raw";
import composerAttachSource from "./ComposerAttachControl.tsx?raw";
import motionDriverSource from "./SceneryMotion.tsx?raw";

const motionStylesSource = NodeFS.readFileSync(new URL("./motion.css", import.meta.url), "utf8");
const sceneryStylesSource = NodeFS.readFileSync(new URL("./scenery.css", import.meta.url), "utf8");
const indexStylesSource = NodeFS.readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("row arrival contract with the messages timeline", () => {
  it("row wrappers still carry data-timeline-root", () => {
    expect(messagesTimelineSource).toContain('data-timeline-root="true"');
  });

  it("seeds the first paint of a thread instead of racing the load window", () => {
    expect(motionDriverSource).toContain("shouldDeferThreadSeed");
    expect(motionDriverSource).toContain("firstPaintForThread");
    expect(motionDriverSource).toContain("ENTER_CLEAR_MS");
    expect(motionStylesSource).toContain(
      "animation: scenery-row-rise 220ms var(--sc-ease-out) both",
    );
  });

  it("rows still expose id, kind and role attributes", () => {
    expect(messagesTimelineSource).toContain("data-timeline-row-id={row.id}");
    expect(messagesTimelineSource).toContain("data-timeline-row-kind={row.kind}");
    expect(messagesTimelineSource).toContain("data-message-role");
  });
});

describe("working-row thinking indicator contract", () => {
  it("the working row still renders the original pulse-dot cluster", () => {
    expect(messagesTimelineSource).toContain('"working"');
    expect(messagesTimelineSource).toContain("inline-flex items-center gap-[3px]");
    expect(messagesTimelineSource).toContain("animate-status-pulse");
  });

  it("does not overlay thinking orbs on the working row, scroll pill, or hero", () => {
    expect(motionDriverSource).not.toContain("ThinkingOrb");
    expect(motionDriverSource).not.toContain("scenery-orb-slot");
    expect(motionStylesSource).not.toContain("scenery-orb-slot");
    expect(motionStylesSource).not.toContain("scenery-orb-hero");
  });

  it("never clones the transient working row into a fixed-position exit ghost", () => {
    expect(motionDriverSource).not.toContain("workingRow.cloneNode");
    expect(motionDriverSource).not.toContain("scenery-ghost-exit");
    expect(motionStylesSource).not.toContain("scenery-ghost-exit");
  });

  it("filters body mutations before scheduling a full motion sync", () => {
    expect(motionDriverSource).toContain("mutationsRequireSceneryMotionSync(mutations)");
  });
});

describe("composer attach mutation contract", () => {
  it("filters body mutations before scheduling a composer attach sync", () => {
    expect(composerAttachSource).toContain("mutationsRequireComposerAttachSync(mutations)");
  });
});

describe("tool card disclosure contract", () => {
  it("the expanded body still mounts under the ms-7 indent wrapper", () => {
    expect(messagesTimelineSource).toContain("mb-1 ms-7 mt-0.5");
  });

  it("status verdict icons still live in the gap-1 indicator cluster, wrapped in a span", () => {
    expect(messagesTimelineSource).toContain("gap-1 text-icon-muted");
    expect(messagesTimelineSource).toContain('aria-label="Tool call failed"');
    expect(motionStylesSource).toContain('[class*="gap-1 text-icon-muted"]');
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

  it("approval / question / plan panels still mount under the rounded-t-[19px] wrapper", () => {
    expect(chatComposerSource).toContain('data-chat-composer-form="true"');
    expect(chatComposerSource).toContain(
      'className="rounded-t-[19px] border-b border-border/65 bg-muted/20"',
    );
    expect(chatComposerSource).toContain("flex flex-wrap items-center justify-end gap-2 px-3 pb-3");
    expect(primaryActionsSource).toContain('data-chat-composer-implement-actions="true"');
  });

  it("draft attachments still own a direct-child Remove button inside the editor chrome", () => {
    expect(chatComposerSource).toContain('data-chat-composer-editor-chrome="true"');
    expect(chatComposerSource).toContain("aria-label={`Remove ${image.name}`}");
    expect(composerAttachSource).toContain("aria-label={`Remove ${props.file.name}`}");
  });

  it("the agent-question option check still swaps in as a lucide CheckIcon inside the collapsible", () => {
    expect(pendingUserInputSource).toContain("<CollapsiblePanel");
    expect(pendingUserInputSource).toContain(
      '<CheckIcon className="size-3.5 shrink-0 text-primary" />',
    );
  });

  it("the sync pill is still the only role=status in the composer overlay", () => {
    expect(threadSyncPillSource).toContain('role="status"');
    expect(chatViewSource).toContain('data-chat-workspace-drop-overlay="true"');
  });
});

describe("timeline and lightbox contract", () => {
  it("the changed-files body still follows its header", () => {
    expect(changedFilesSource).toContain('data-changed-files-header=""');
  });

  it("the minimap preview and lightbox still carry their hooks", () => {
    expect(messagesTimelineSource).toContain("data-minimap-preview");
    expect(expandedImageSource).toContain('aria-label="Expanded image preview"');
    expect(expandedImageSource).toContain('<div className="relative isolate z-10');
  });
});

describe("sidebar motion contract", () => {
  it("icon-size sidebar buttons still expose data-slot/data-size", () => {
    expect(uiSidebarSource).toContain('"data-slot": "sidebar-menu-button"');
    expect(uiSidebarSource).toContain('"data-size": size');
  });

  it("thread rows and the woke pill still carry their hooks", () => {
    expect(sidebarSource).toContain('data-testid="sidebar-row-card"');
    expect(sidebarSource).toContain('aria-label="Dismiss Woke notification"');
    expect(sidebarSource).toContain('"opacity-70 transition-opacity hover:opacity-100"');
  });

  it("the provider update pill still exits with the translate/opacity pair the entry mirrors", () => {
    expect(providerUpdatePillSource).toContain("provider-update-main");
    expect(providerUpdatePillSource).toContain("translate-y-1.5 opacity-0");
    expect(uiSidebarSource).toContain('data-slot="sidebar-footer"');
  });
});

describe("right panel contract", () => {
  it("agent rows still label their toggle and mark completion with text-success", () => {
    expect(rightPanelTabsSource).toContain("data-right-panel-surface-content");
    expect(rightPanelTabsSource).toContain("data-surface-launcher-keys=");
    expect(agentsPanelSource).toContain("} activity for ${agent.title}");
    expect(agentsPanelSource).toContain('<Check aria-hidden className="size-3 text-success" />');
  });
});

describe("dialog contract", () => {
  it("dialog slots and AnimatedHeight still expose their data-slots", () => {
    expect(dialogSource).toContain('data-slot="dialog-popup"');
    expect(dialogSource).toContain('data-slot="dialog-panel"');
    expect(animatedHeightSource).toContain('data-slot="animated-height"');
    expect(gitActionsSource).toContain("bg-success/15");
  });

  it("What's New, the theme editor and the quit hint still carry their hooks", () => {
    expect(whatsNewSource).toContain('aria-label="What\'s new"');
    expect(whatsNewSource).toContain("<SparklesIcon");
    expect(whatsNewSource).toContain('"--sc-i": Math.min(index, 5)');
    expect(themeEditorSource).toContain('"dialog-glass fixed z-[110]');
    expect(themeEditorSource).toContain("data-theme-editor-panel");
    expect(themeEditorSource).toContain('role="dialog"');
    expect(quitHoldSource).toContain('role="status"');
    expect(quitHoldSource).toContain("z-100");
  });
});

describe("primitive and settings contract", () => {
  it("checkbox / radio indicators and toast icons still expose data-slots", () => {
    expect(checkboxSource).toContain('data-slot="checkbox-indicator"');
    expect(radioGroupSource).toContain('data-slot="radio-indicator"');
    expect(toastSource).toContain('data-slot="toast-icon"');
    expect(toastSource).toContain('data-slot="toast-viewport"');
  });

  it("settings reset buttons, the pairing QR panel and hosted pairing keep their hooks", () => {
    expect(settingsLayoutSource).toContain("aria-label={`Reset ${label} to default`}");
    expect(settingsLayoutSource).toContain("data-settings-page-scroll");
    expect(connectionsSettingsSource).toContain('data-pairing-qr-panel=""');
    expect(pairingRouteSource).toContain("data-pairing-status={status}");
    expect(indexStylesSource).toContain('[data-pairing-status="paired"] h1');
  });

  it("first-run heroes still use max-w-none EmptyHeaders", () => {
    expect(emptySource).toContain('data-slot="empty-header"');
    expect(noActiveThreadSource).toContain('<EmptyHeader className="max-w-none">');
    expect(chatIndexRouteSource).toContain('<EmptyHeader className="max-w-none">');
  });

  it("reduced motion still zeroes the movement multiplier after the dock left", () => {
    expect(sceneryStylesSource).not.toContain(".scenery-quick__panel");
    expect(motionStylesSource).toContain("--sc-m: 0;");
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

  it("working sidebar rows keep a quiet text-only status label", () => {
    expect(sidebarSource).toContain("data-thread-item");
    expect(sidebarSource).toContain('label: "Working"');
    expect(sidebarSource).not.toContain("CircleDashedIcon");
    expect(motionDriverSource).not.toContain("scenery-orb-slot--sidebar");
    expect(motionStylesSource).not.toContain("scenery-orb-slot--sidebar");
  });

  it("keeps the working label quiet without an infinite animation", () => {
    expect(sidebarSource).toContain("data-sidebar-working-label");
    expect(motionStylesSource).toContain("[data-sidebar-working-label]");
    expect(motionStylesSource).not.toContain("scenery-sidebar-working-breathe");
  });
});

describe("changed-files card contract", () => {
  it("the card still exposes data-changed-files-state", () => {
    expect(changedFilesSource).toContain("data-changed-files-state");
  });
});
