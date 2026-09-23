import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";

import { isElectron } from "../env";
import { getLocalStorageItem, removeLocalStorageItem } from "../hooks/useLocalStorage";
import {
  isRichTextBoldShortcut,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isPreviewFocused } from "../lib/previewFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import { resolveThreadRouteRef } from "../threadRoutes";
import { cn, isMacPlatform } from "../lib/utils";
import { primaryServerKeybindingsAtom } from "../state/server";
import { useEnvironmentIdentificationMode, useLegacySidebarEnabled } from "../hooks/useSettings";
import {
  hideMacosWindowButtonsThenReleaseInset,
  MACOS_TRAFFIC_LIGHT_REVEAL_DELAY_MS,
  shouldReserveMacosTrafficLights,
  shouldShowMacosWindowButtons,
} from "../workspaceTitlebar";
import {
  PanelAnimationSuppressionProvider,
  usePanelAnimationSettings,
  usePanelNavigationSuppression,
} from "../panelAnimations";
import ThreadSidebar from "./Sidebar";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import { SidebarChromeHeader } from "./sidebar/SidebarChrome";
import {
  resolveSidebarStageFocusRingOffsetClass,
  useSidebarStageBackdropVariant,
} from "./SidebarStageBackdrop";
import { useProjects } from "../state/entities";
import {
  resolveInitialThreadSidebarWidth,
  resolveThreadSidebarCssWidth,
  resolveThreadSidebarMaximumWidth,
  THREAD_MAIN_CONTENT_MIN_WIDTH,
  THREAD_SIDEBAR_DEFAULT_WIDTH,
  THREAD_SIDEBAR_MIN_WIDTH,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "./threadSidebarWidth";
import {
  Sidebar,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
  useSidebarVisibility,
  type SidebarResizableOptions,
} from "./ui/sidebar";
import {
  SIDEBAR_PEEK_ANIMATION_MS,
  SIDEBAR_PEEK_EASE,
  useSidebarPeekPointerBinding,
} from "./ui/sidebarPeek";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function SidebarPeekNavigationGuard() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { retainPeekIfHovered } = useSidebar();
  const retainRef = useRef(retainPeekIfHovered);
  retainRef.current = retainPeekIfHovered;

  useLayoutEffect(() => {
    // Thread switches replace the row under the cursor and synthesize a leave
    // while the pointer is still in the hover surface. Re-assert before paint,
    // and once more after the browser has dispatched that leave.
    retainRef.current();
    let timer = 0;
    const frame = window.requestAnimationFrame(() => {
      retainRef.current();
      timer = window.setTimeout(() => retainRef.current(), 0);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [pathname]);

  return null;
}

function readInitialThreadSidebarWidth(): number {
  try {
    return resolveInitialThreadSidebarWidth(
      getLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY, Schema.Finite),
    );
  } catch (error) {
    console.error("Could not read persisted thread sidebar width.", error);
    return resolveInitialThreadSidebarWidth(null);
  }
}

function SidebarControl({
  isMacosDesktop,
  isWindowFullscreen,
}: {
  isMacosDesktop: boolean;
  isWindowFullscreen: boolean;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const {
    isMobile,
    open,
    peeking,
    toggleSidebar,
    onPeekPointerEnter,
    onPeekPointerLeave,
    onPeekPointerHold,
  } = useSidebar();
  const peekPointer = useSidebarPeekPointerBinding(
    onPeekPointerEnter,
    onPeekPointerLeave,
    onPeekPointerHold,
  );
  const isSidebarVisible = useSidebarVisibility();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const stageBackdropVariant = useSidebarStageBackdropVariant(
    environmentIdentificationMode === "artwork",
  );
  const shortcutLabel = shortcutLabelForCommand(keybindings, "sidebar.toggle");
  const trafficLights = {
    isMacosDesktop,
    isMobile,
    sidebarOpen: open,
    sidebarPeeking: peeking,
  };
  const reserveTrafficLights = shouldReserveMacosTrafficLights({
    ...trafficLights,
    isFullscreen: isWindowFullscreen,
  });
  const showWindowButtons = shouldShowMacosWindowButtons(trafficLights);
  const windowButtonVisibilityQueue = useRef(Promise.resolve());
  const sendWindowButtonVisibility = (visible: boolean) => {
    const setVisibility = window.desktopBridge?.setWindowButtonVisibility;
    if (typeof setVisibility !== "function") return Promise.resolve();
    const next = windowButtonVisibilityQueue.current.then(() => setVisibility(visible));
    windowButtonVisibilityQueue.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  useLayoutEffect(() => {
    if (!isMacosDesktop) {
      document.documentElement.removeAttribute("data-macos-traffic-lights");
      return;
    }

    const root = document.documentElement;
    let cancelled = false;
    let revealTimer = 0;

    if (!showWindowButtons) {
      void hideMacosWindowButtonsThenReleaseInset({
        hide: () => sendWindowButtonVisibility(false),
        releaseInset: () => {
          if (!cancelled) root.removeAttribute("data-macos-traffic-lights");
        },
      });
      return () => {
        cancelled = true;
      };
    }

    root.toggleAttribute("data-macos-traffic-lights", reserveTrafficLights);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : MACOS_TRAFFIC_LIGHT_REVEAL_DELAY_MS;
    revealTimer = window.setTimeout(() => {
      void sendWindowButtonVisibility(true);
    }, delay);
    return () => {
      cancelled = true;
      window.clearTimeout(revealTimer);
    };
  }, [isMacosDesktop, reserveTrafficLights, showWindowButtons]);

  useLayoutEffect(
    () => () => {
      document.documentElement.removeAttribute("data-macos-traffic-lights");
      void sendWindowButtonVisibility(true);
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      if (
        isRichTextBoldShortcut(event) &&
        event.target instanceof HTMLElement &&
        event.target.closest('[data-composer-rich-text="true"]')
      ) {
        // The rich-text composer claims Mod+B for bold; the toggle stays
        // available everywhere else, including the plain-text composer.
        return;
      }
      if (resolveShortcutCommand(event, keybindings) !== "sidebar.toggle") return;

      event.preventDefault();
      event.stopPropagation();
      toggleSidebar();
    };

    // Capture before focused editors consume commands such as Mod+B for rich-text formatting.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [keybindings, toggleSidebar]);

  return (
    // The right-side layout controls carry mr-px (border compensation inside
    // the panel), so the trigger mirrors it: both clusters sit one extra pixel
    // off their edge and the titlebar reads symmetric.
    <div
      className="pointer-events-auto fixed left-[calc(env(safe-area-inset-left)+0.75rem)] top-[var(--workspace-controls-top)] z-50 ml-px flex h-[var(--workspace-topbar-height)] items-center [-webkit-app-region:no-drag]"
      data-sidebar-control=""
      style={
        {
          "--sidebar-peek-duration": `${SIDEBAR_PEEK_ANIMATION_MS}ms`,
          "--sidebar-peek-ease": SIDEBAR_PEEK_EASE,
        } as CSSProperties
      }
      onPointerEnter={peekPointer.onPointerEnter}
      onPointerLeave={peekPointer.onPointerLeave}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarTrigger
              // Over the stage artwork the trigger is a control on imagery, like the media
              // viewer's arrows; that variant positions itself, so the layout is reset here.
              variant={isSidebarVisible && stageBackdropVariant ? "media-navigation" : "ghost"}
              className={cn(
                "pointer-events-auto",
                isSidebarVisible && stageBackdropVariant && "relative top-auto translate-y-0",
                isSidebarVisible &&
                  stageBackdropVariant &&
                  resolveSidebarStageFocusRingOffsetClass(stageBackdropVariant),
              )}
              aria-label="Toggle main sidebar"
            />
          }
        />
        <TooltipPopup side="bottom">
          Toggle main sidebar{shortcutLabel ? ` (${shortcutLabel})` : ""}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}

// Moves through the app's route history like a browser's back/forward buttons.
function NavigationHistoryShortcuts() {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("[data-keybinding-capture]")
      ) {
        return;
      }
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: routeThreadRef
            ? selectThreadTerminalUiState(
                useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
                routeThreadRef,
              ).terminalOpen
            : false,
          previewFocus: isPreviewFocused(),
          previewOpen: routeThreadRef
            ? selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, routeThreadRef) ===
              "preview"
            : false,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      if (command !== "navigation.back" && command !== "navigation.forward") return;

      event.preventDefault();
      event.stopPropagation();
      if (command === "navigation.back") window.history.back();
      else window.history.forward();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, routeThreadRef]);

  return null;
}

// Settings swaps the thread sidebar out of the tree. Keep the lightweight
// project projection subscribed so returning to a draft never renders the
// zero-project state while the environment snapshot reconnects.
function ProjectProjectionRetention() {
  useProjects();
  return null;
}

// Only users who opted into the legacy sidebar pay for its chunk.
const LegacyThreadSidebar = lazy(() => import("./LegacySidebar"));

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const legacySidebarEnabled = useLegacySidebarEnabled();
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings();
  // Settings routes show the settings nav in place of whichever thread
  // sidebar is active.
  const pathname = useLocation({ select: (location) => location.pathname });
  const panelAnimationsSuppressed = usePanelNavigationSuppression(pathname);
  const routePanelAnimationsActive = panelAnimationsActive && !panelAnimationsSuppressed;
  const isOnSettings = pathname === "/settings" || pathname.startsWith("/settings/");
  const isMacosDesktop = isElectron && isMacPlatform(navigator.platform);
  const [sidebarWidth, setSidebarWidth] = useState(readInitialThreadSidebarWidth);
  // Stable options object: the drag limits resolve against the live window at
  // drag time, so no viewport subscription is needed here and the rail never
  // sees a stale cap.
  const sidebarResizable = useMemo<SidebarResizableOptions>(
    () => ({
      getCssWidth: resolveThreadSidebarCssWidth,
      maxWidth: () => resolveThreadSidebarMaximumWidth(window.innerWidth),
      minWidth: THREAD_SIDEBAR_MIN_WIDTH,
      shouldAcceptWidth: ({ currentWidth, nextWidth, wrapper }) =>
        nextWidth <= currentWidth ||
        wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
      storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
      onResize: setSidebarWidth,
    }),
    [],
  );
  const resetSidebarWidth = () => {
    try {
      removeLocalStorageItem(THREAD_SIDEBAR_WIDTH_STORAGE_KEY);
    } catch (error) {
      console.error("Could not clear persisted thread sidebar width.", error);
    }
    setSidebarWidth(THREAD_SIDEBAR_DEFAULT_WIDTH);
  };
  const [isWindowFullscreen, setIsWindowFullscreen] = useState(() => {
    const getWindowFullscreenState = window.desktopBridge?.getWindowFullscreenState;
    return isMacosDesktop && typeof getWindowFullscreenState === "function"
      ? getWindowFullscreenState()
      : false;
  });
  const sidebarProviderStyle = {
    "--sidebar-width": resolveThreadSidebarCssWidth(sidebarWidth),
    "--panel-animation-duration": `${panelAnimationDurationMs}ms`,
  } as CSSProperties;

  useEffect(() => {
    if (!isMacosDesktop) return;
    const bridge = window.desktopBridge;
    if (!bridge) return;
    const { getWindowFullscreenState, onWindowFullscreenStateChange } = bridge;
    if (
      typeof getWindowFullscreenState !== "function" ||
      typeof onWindowFullscreenStateChange !== "function"
    ) {
      return;
    }

    const unsubscribe = onWindowFullscreenStateChange(setIsWindowFullscreen);
    setIsWindowFullscreen(getWindowFullscreenState());
    return unsubscribe;
  }, [isMacosDesktop]);

  // Window chrome state lands on <html> as plain attributes rather than React
  // state: only CSS reads it, so a re-render of the whole app would be pure
  // waste. `data-window-inactive` follows the AppKit convention of dimming an
  // unfocused window; `data-window-interacting` lets dialog/composer glass
  // drop out for a drag or resize. `will-move` without `moved` can leave that
  // flag stuck, so drop it if the main process never sends false.
  useEffect(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;
    const { onWindowActiveStateChange, onWindowInteractingChange } = bridge;
    const root = document.documentElement;
    const unsubscribeActive = onWindowActiveStateChange?.((active) => {
      root.toggleAttribute("data-window-inactive", !active);
    });
    let interactingClearTimer = 0;
    const unsubscribeInteracting = onWindowInteractingChange?.((interacting) => {
      window.clearTimeout(interactingClearTimer);
      root.toggleAttribute("data-window-interacting", interacting);
      if (interacting) {
        interactingClearTimer = window.setTimeout(() => {
          root.removeAttribute("data-window-interacting");
        }, 800);
      }
    });

    return () => {
      window.clearTimeout(interactingClearTimer);
      unsubscribeActive?.();
      unsubscribeInteracting?.();
      root.removeAttribute("data-window-inactive");
      root.removeAttribute("data-window-interacting");
    };
  }, []);

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action === "open-settings") {
        const isSettingsRoute = /^\/settings(\/|$)/.test(pathname);
        if (!isSettingsRoute) {
          void navigate({ to: "/settings" });
        }
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate, pathname]);

  return (
    <PanelAnimationSuppressionProvider value={panelAnimationsSuppressed}>
      <SidebarProvider
        className="h-dvh! min-h-0!"
        data-panel-animations={routePanelAnimationsActive ? "true" : "false"}
        defaultOpen
        style={sidebarProviderStyle}
      >
        <ProjectProjectionRetention />
        <SidebarPeekNavigationGuard />
        <Sidebar
          side="left"
          collapsible="icon"
          data-app-sidebar=""
          className="workspace-sidebar-glass group-data-[side=left]:border-r-0 text-sidebar-foreground"
          resizable={sidebarResizable}
        >
          {isOnSettings ? (
            <>
              <SidebarChromeHeader isElectron={isElectron} />
              <SettingsSidebarNav pathname={pathname} />
            </>
          ) : legacySidebarEnabled ? (
            <Suspense fallback={null}>
              <LegacyThreadSidebar />
            </Suspense>
          ) : (
            <ThreadSidebar />
          )}
          <SidebarRail onDoubleClick={resetSidebarWidth} />
        </Sidebar>
        {children}
        <SidebarControl isMacosDesktop={isMacosDesktop} isWindowFullscreen={isWindowFullscreen} />
        <NavigationHistoryShortcuts />
      </SidebarProvider>
    </PanelAnimationSuppressionProvider>
  );
}
