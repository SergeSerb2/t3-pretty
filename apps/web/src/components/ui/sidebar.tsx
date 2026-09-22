import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { PanelLeftCloseIcon, PanelLeftIcon } from "lucide-react";
import * as React from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "~/components/ui/sheet";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useResizeDrag } from "~/hooks/useResizeDrag";
import { useIsMobile } from "~/hooks/useMediaQuery";
import { useTeslaTouchUi } from "~/teslaTouchUi";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { clampSidebarWidth, formatSidebarWidth } from "./sidebarResize";
import { resolveSidebarState, type ResponsiveSidebarState } from "./sidebarState";
import {
  SIDEBAR_PEEK_ANIMATION_MS,
  SIDEBAR_PEEK_EASE,
  useSidebarPeek,
  useSidebarPeekPointerBinding,
} from "./sidebarPeek";
import * as Schema from "effect/Schema";

const SIDEBAR_COOKIE_NAME = "sidebar_state";
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_MOBILE = "calc(100vw - var(--spacing(3)))";
const SIDEBAR_WIDTH_TESLA = "min(26rem, calc(100vw - 2.5rem))";
const SIDEBAR_WIDTH_ICON = "3rem";
const SIDEBAR_RESIZE_DEFAULT_MIN_WIDTH = 16 * 16;

type SidebarContextProps = {
  state: ResponsiveSidebarState;
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
  peeking: boolean;
  peekFlyout: boolean;
  peekNow: () => void;
  retainPeekIfHovered: () => void;
  onPeekPointerEnter: (event?: React.PointerEvent<Element>) => void;
  onPeekPointerLeave: (event?: React.PointerEvent<Element>) => void;
  onPeekPointerHold: () => void;
};

type SidebarResizableOptions = {
  // Viewport-clamped CSS expression so a static pixel write cannot lock later drags.
  getCssWidth?: (width: number) => string;
  // Resolved on every drag frame so the cap tracks the live window.
  maxWidth?: number | (() => number);
  minWidth?: number;
  onResize?: (width: number) => void;
  shouldAcceptWidth?: (context: {
    currentWidth: number;
    nextWidth: number;
    rail: HTMLButtonElement;
    side: "left" | "right";
    sidebarRoot: HTMLElement;
    wrapper: HTMLElement;
  }) => boolean;
  storageKey?: string;
};

type SidebarResolvedResizableOptions = {
  getCssWidth?: (width: number) => string;
  maxWidth: number | (() => number);
  minWidth: number;
  onResize?: (width: number) => void;
  shouldAcceptWidth?: (context: {
    currentWidth: number;
    nextWidth: number;
    rail: HTMLButtonElement;
    side: "left" | "right";
    sidebarRoot: HTMLElement;
    wrapper: HTMLElement;
  }) => boolean;
  storageKey: string | null;
};

type SidebarInstanceContextProps = {
  resizable: SidebarResolvedResizableOptions | null;
  side: "left" | "right";
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);
const SidebarInstanceContext = React.createContext<SidebarInstanceContextProps | null>(null);

function useSidebar() {
  const context = React.use(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }

  return context;
}

function useSidebarVisibility() {
  const { isMobile, open, openMobile } = useSidebar();
  return isMobile ? openMobile : open;
}

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isNarrowViewport = useIsMobile();
  const teslaTouch = useTeslaTouchUi();
  const isMobile = isNarrowViewport || teslaTouch;
  const [openMobile, setOpenMobile] = React.useState(false);

  // This is the internal state of the sidebar.
  // We use openProp and setOpenProp for control from outside the component.
  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;
  const setOpen = React.useCallback(
    async (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === "function" ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        _setOpen(openState);
      }

      // This sets the cookie to keep the sidebar state.
      await cookieStore.set({
        expires: Date.now() + SIDEBAR_COOKIE_MAX_AGE * 1000,
        name: SIDEBAR_COOKIE_NAME,
        path: "/",
        value: String(openState),
      });
    },
    [setOpenProp, open],
  );

  // We add a state so that we can do data-state="expanded" or "collapsed".
  // This makes it easier to style the sidebar with Tailwind classes.
  const state = resolveSidebarState({ isMobile, open, openMobile });
  const {
    peeking,
    peekFlyout,
    peekNow,
    noteUserCollapsedSidebar,
    retainPeekIfHovered,
    onPeekPointerEnter,
    onPeekPointerLeave,
    onPeekPointerHold,
  } = useSidebarPeek(!isMobile && !open);

  // Helper to toggle the sidebar.
  const toggleSidebar = React.useCallback(() => {
    if (isMobile) {
      setOpenMobile((open) => !open);
      return;
    }
    // Collapsing while the pointer rests on the trigger is not a new hover.
    if (open) noteUserCollapsedSidebar();
    setOpen((open) => !open);
  }, [isMobile, noteUserCollapsedSidebar, open, setOpen, setOpenMobile]);

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({
      isMobile,
      open,
      openMobile,
      setOpen,
      setOpenMobile,
      state,
      toggleSidebar,
      peeking,
      peekFlyout,
      peekNow,
      retainPeekIfHovered,
      onPeekPointerEnter,
      onPeekPointerLeave,
      onPeekPointerHold,
    }),
    [
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      toggleSidebar,
      peeking,
      peekFlyout,
      peekNow,
      retainPeekIfHovered,
      onPeekPointerEnter,
      onPeekPointerLeave,
      onPeekPointerHold,
    ],
  );

  return (
    <SidebarContext value={contextValue}>
      <div
        // Inset layouts opt into bg-sidebar through className.
        className={cn(
          "group/sidebar-wrapper flex min-h-svh w-full max-sm:[--workspace-titlebar-control-size:--spacing(8)]",
          className,
        )}
        data-sidebar-peeking={peekFlyout ? "" : undefined}
        data-sidebar-state={state}
        data-slot="sidebar-wrapper"
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            "--workspace-titlebar-content-left":
              "calc(var(--workspace-controls-left) + var(--workspace-titlebar-control-size) + var(--workspace-titlebar-control-gap))",
            ...style,
          } as React.CSSProperties
        }
        {...props}
      >
        {children}
      </div>
    </SidebarContext>
  );
}

function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  resizable = false,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  side?: "left" | "right";
  variant?: "sidebar" | "floating" | "inset";
  collapsible?: "offcanvas" | "icon" | "none";
  resizable?: boolean | SidebarResizableOptions;
}) {
  const {
    isMobile,
    state,
    openMobile,
    setOpenMobile,
    peeking,
    peekFlyout,
    onPeekPointerEnter,
    onPeekPointerLeave,
    onPeekPointerHold,
  } = useSidebar();
  const teslaTouch = useTeslaTouchUi();
  const resolvedResizable = React.useMemo<SidebarResolvedResizableOptions | null>(() => {
    if (isMobile || collapsible === "none" || !resizable) {
      return null;
    }

    const options = typeof resizable === "boolean" ? {} : resizable;
    return {
      maxWidth: options.maxWidth ?? Number.POSITIVE_INFINITY,
      minWidth: options.minWidth ?? SIDEBAR_RESIZE_DEFAULT_MIN_WIDTH,
      storageKey: options.storageKey ?? null,
      ...(options.getCssWidth ? { getCssWidth: options.getCssWidth } : {}),
      ...(options.onResize ? { onResize: options.onResize } : {}),
      ...(options.shouldAcceptWidth ? { shouldAcceptWidth: options.shouldAcceptWidth } : {}),
    };
  }, [collapsible, isMobile, resizable]);
  const instanceContextValue = React.useMemo<SidebarInstanceContextProps>(
    () => ({ side, resizable: resolvedResizable }),
    [resolvedResizable, side],
  );
  const iconCollapsed = state === "collapsed" && collapsible === "icon";
  const [pinOpening, setPinOpening] = React.useState(false);
  const [pinOpeningReady, setPinOpeningReady] = React.useState(false);
  const wasIconCollapsedRef = React.useRef(iconCollapsed);

  React.useEffect(() => {
    if (iconCollapsed) {
      wasIconCollapsedRef.current = true;
      setPinOpening(false);
      setPinOpeningReady(false);
      return;
    }
    if (!wasIconCollapsedRef.current) return;

    setPinOpening(true);
    setPinOpeningReady(false);
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => setPinOpeningReady(true));
    });
    const timeout = window.setTimeout(() => {
      wasIconCollapsedRef.current = false;
      setPinOpening(false);
      setPinOpeningReady(false);
    }, SIDEBAR_PEEK_ANIMATION_MS);
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.clearTimeout(timeout);
    };
  }, [iconCollapsed]);
  const peekPointer = useSidebarPeekPointerBinding(
    onPeekPointerEnter,
    onPeekPointerLeave,
    onPeekPointerHold,
  );

  if (collapsible === "none") {
    return (
      <SidebarInstanceContext value={instanceContextValue}>
        <div
          className={cn(
            "flex h-full w-(--sidebar-width) flex-col bg-sidebar surface-grain text-sidebar-foreground",
            className,
          )}
          data-slot="sidebar"
          {...props}
        >
          {children}
        </div>
      </SidebarInstanceContext>
    );
  }

  if (isMobile) {
    return (
      <SidebarInstanceContext value={instanceContextValue}>
        <Sheet onOpenChange={setOpenMobile} open={openMobile} {...props}>
          <SheetPopup
            className={cn(
              "w-(--sidebar-width) max-w-none bg-sidebar surface-grain p-0 text-sidebar-foreground",
              className,
            )}
            data-mobile="true"
            data-sidebar="sidebar"
            data-slot="sidebar"
            showCloseButton={false}
            side={side}
            style={
              {
                "--sidebar-width": teslaTouch ? SIDEBAR_WIDTH_TESLA : SIDEBAR_WIDTH_MOBILE,
              } as React.CSSProperties
            }
          >
            <SheetHeader className="sr-only">
              <SheetTitle>Sidebar</SheetTitle>
              <SheetDescription>Displays the mobile sidebar.</SheetDescription>
            </SheetHeader>
            <div
              className={cn(
                "flex h-full w-full flex-col pb-safe pt-safe",
                side === "left" ? "pl-safe" : "pr-safe",
              )}
            >
              {children}
            </div>
          </SheetPopup>
        </Sheet>
      </SidebarInstanceContext>
    );
  }

  return (
    <SidebarInstanceContext value={instanceContextValue}>
      <div
        className="group peer hidden text-sidebar-foreground md:block"
        data-collapsed={iconCollapsed ? "" : undefined}
        data-collapsible={state === "collapsed" && collapsible === "offcanvas" ? collapsible : ""}
        data-opening={pinOpening ? "" : undefined}
        data-opening-ready={pinOpeningReady ? "" : undefined}
        data-peeking={peeking && iconCollapsed ? "" : undefined}
        data-present={peekFlyout && iconCollapsed ? "" : undefined}
        data-side={side}
        data-slot="sidebar"
        data-state={state}
        data-variant={variant}
        style={
          {
            "--sidebar-peek-duration": `${SIDEBAR_PEEK_ANIMATION_MS}ms`,
            "--sidebar-peek-ease": SIDEBAR_PEEK_EASE,
          } as React.CSSProperties
        }
      >
        {/* This is what handles the sidebar gap on desktop */}
        <div
          className={cn(
            "relative w-(--sidebar-width) bg-transparent",
            "[[data-panel-animations=true]_&]:transition-[width] [[data-panel-animations=true]_&]:[transition-duration:var(--panel-animation-duration)] [[data-panel-animations=true]_&]:ease-out",
            "group-data-[collapsible=offcanvas]:w-0",
            "group-data-[side=right]:rotate-180",
            variant === "floating" || variant === "inset"
              ? "group-data-collapsed:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]"
              : "group-data-collapsed:w-(--sidebar-width-icon)",
          )}
          data-slot="sidebar-gap"
        />
        <div
          className={cn(
            "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) md:flex",
            "motion-safe:transition-[width,box-shadow] motion-safe:duration-(--sidebar-peek-duration) motion-safe:ease-(--sidebar-peek-ease) group-data-collapsed:duration-(--sidebar-peek-duration)!",
            "[[data-panel-animations=true]_&]:transition-[left,right,width,box-shadow] [[data-panel-animations=true]_&]:[transition-duration:var(--panel-animation-duration)] [[data-panel-animations=true]_&]:ease-out",
            side === "left"
              ? "left-0 group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)]"
              : "right-0 group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)]",
            variant === "floating" || variant === "inset"
              ? "p-2 group-data-collapsed:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]"
              : "group-data-collapsed:w-(--sidebar-width-icon) group-data-[side=left]:border-r group-data-[side=right]:border-l",
            // Stay above the chat through the close width animation; the gap
            // never leaves icon width, so nothing in the page reflows.
            "group-data-present:z-40 group-data-collapsed:group-data-peeking:w-(--sidebar-width)! group-data-present:shadow-[12px_0_40px_rgba(0,0,0,0.12)]",
            className,
          )}
          data-slot="sidebar-container"
          {...props}
          onPointerEnter={(event) => {
            props.onPointerEnter?.(event);
            peekPointer.onPointerEnter(event);
          }}
          onPointerLeave={(event) => {
            props.onPointerLeave?.(event);
            peekPointer.onPointerLeave(event);
          }}
        >
          <div
            className="h-full w-full min-w-0 group-data-collapsed:overflow-hidden group-data-present:overflow-hidden group-data-opening:overflow-hidden"
            data-slot="sidebar-clip"
          >
            <div
              className="flex h-full w-(--sidebar-width) min-w-(--sidebar-width) flex-col bg-sidebar surface-grain group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border group-data-[variant=floating]:border-sidebar-border group-data-[variant=floating]:shadow-sm/5"
              data-sidebar="sidebar"
              data-slot="sidebar-inner"
            >
              {children}
            </div>
          </div>
          {/* The container width is still animating when the pointer reaches the
              titlebar. This strip is the not-yet-revealed band, so moving up
              toward the traffic lights does not count as leaving. */}
          <div aria-hidden data-sidebar-peek-hover-bridge="" />
          {/* Outside the clip so a collapsed overflow:hidden cannot square the
              corner or drop the column edge. */}
          <div aria-hidden data-sidebar-frame-corner="" />
          <div aria-hidden data-sidebar-frame-edge="" />
        </div>
      </div>
    </SidebarInstanceContext>
  );
}

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();
  const isOpen = useSidebarVisibility();

  return (
    <Button
      className={cn(
        "size-[var(--workspace-titlebar-control-size)]! [-webkit-app-region:no-drag]",
        className,
      )}
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      aria-pressed={isOpen}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      size="icon"
      variant="ghost"
      {...props}
    >
      {isOpen ? <PanelLeftCloseIcon className="size-4" /> : <PanelLeftIcon className="size-4" />}
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  );
}

function SidebarRail({
  className,
  onClick,
  onPointerCancel,
  onLostPointerCapture,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  ...props
}: React.ComponentProps<"button">) {
  const { open, toggleSidebar } = useSidebar();
  const sidebarInstance = React.use(SidebarInstanceContext);
  const railRef = React.useRef<HTMLButtonElement | null>(null);
  const suppressClickRef = React.useRef(false);
  const resolvedResizable = sidebarInstance?.resizable ?? null;
  const latestResizable = React.useRef(resolvedResizable);
  React.useLayoutEffect(() => {
    latestResizable.current = resolvedResizable;
  }, [resolvedResizable]);
  const canResize = resolvedResizable !== null && open;
  const railLabel = canResize ? "Resize Sidebar" : "Toggle Sidebar";
  const railTitle = canResize ? "Drag to resize sidebar" : "Toggle Sidebar";
  const resize = useResizeDrag<HTMLButtonElement>((event) => {
    if (!resolvedResizable || !open) return null;
    const rail = event.currentTarget;
    const wrapper = rail.closest<HTMLElement>("[data-slot='sidebar-wrapper']");
    const sidebarRoot = rail.closest<HTMLElement>("[data-slot='sidebar']");
    const sidebarContainer = sidebarRoot?.querySelector<HTMLElement>(
      "[data-slot='sidebar-container']",
    );
    if (!wrapper || !sidebarRoot || !sidebarContainer) return null;

    const side = sidebarInstance?.side ?? "left";
    const measuredWidth = sidebarContainer.getBoundingClientRect().width;
    let width = clampSidebarWidth(measuredWidth, resolvedResizable);
    const startWidth = width;
    const originalCssWidth = wrapper.style.getPropertyValue("--sidebar-width");
    const transitionTargets = [
      sidebarRoot.querySelector<HTMLElement>("[data-slot='sidebar-gap']"),
      sidebarContainer,
    ].filter((element): element is HTMLElement => element !== null);
    transitionTargets.forEach((element) => {
      element.style.setProperty("transition-duration", "0ms");
    });
    // Only rewrite an out-of-range width. An in-range write would replace the
    // viewport-clamped CSS expression with a static pixel value and leave the
    // next drag unable to grow back into a stored preference.
    if (width !== measuredWidth) {
      wrapper.style.setProperty(
        "--sidebar-width",
        formatSidebarWidth(width, resolvedResizable.getCssWidth),
      );
    }

    return {
      width,
      edge: side === "left" ? "right" : "left",
      resize(value) {
        const options = latestResizable.current;
        if (!options) return width;
        const nextWidth = clampSidebarWidth(value, options);
        const accepted =
          options.shouldAcceptWidth?.({
            currentWidth: width,
            nextWidth,
            rail,
            side,
            sidebarRoot,
            wrapper,
          }) ?? true;
        if (accepted && nextWidth !== width) {
          wrapper.style.setProperty(
            "--sidebar-width",
            formatSidebarWidth(nextWidth, options.getCssWidth),
          );
          width = nextWidth;
        }
        return width;
      },
      finish(finalWidth, moved) {
        suppressClickRef.current = moved;
        const options = latestResizable.current;
        if (finalWidth === startWidth) {
          if (wrapper.style.getPropertyValue("--sidebar-width") !== originalCssWidth) {
            wrapper.style.setProperty("--sidebar-width", originalCssWidth);
          }
          return;
        }
        if (options?.storageKey) {
          try {
            setLocalStorageItem(options.storageKey, finalWidth, Schema.Finite);
          } catch (error) {
            console.error("Could not persist sidebar width.", error);
          }
        }
        options?.onResize?.(finalWidth);
      },
      cleanup() {
        transitionTargets.forEach((element) => {
          element.style.removeProperty("transition-duration");
        });
      },
    };
  });

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        event.preventDefault();
        return;
      }
      if (resolvedResizable && open) {
        event.preventDefault();
        return;
      }
      toggleSidebar();
    },
    [onClick, open, resolvedResizable, toggleSidebar],
  );

  React.useLayoutEffect(() => {
    if (!resolvedResizable?.storageKey || typeof window === "undefined") return;
    const rail = railRef.current;
    if (!rail) return;
    const wrapper = rail.closest<HTMLElement>("[data-slot='sidebar-wrapper']");
    if (!wrapper) return;

    let storedWidth: number | null;
    try {
      storedWidth = getLocalStorageItem(resolvedResizable.storageKey, Schema.Finite);
    } catch (error) {
      console.error("Could not restore persisted sidebar width.", error);
      return;
    }
    if (storedWidth === null) return;
    const width = Math.max(resolvedResizable.minWidth, storedWidth);
    // Hydrate the CSS variable before the browser paints so a restored sidebar
    // never flashes at the default width first. Keep the preference-backed
    // expression; writing a clamped pixel width here used to lock later drags.
    wrapper.style.setProperty(
      "--sidebar-width",
      formatSidebarWidth(width, resolvedResizable.getCssWidth),
    );
  }, [resolvedResizable]);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={railLabel}
            className={cn(
              /* disable pointer events only when offcanvas sidebar is collapsed, that's when the rail sits over the native scrollbar on windows and linux. icon mode stays fully clickable. */
              "pointer-events-auto -translate-x-1/2 group-data-[side=left]:-right-4 absolute inset-y-0 z-20 hidden w-4 group-data-[side=right]:left-0 sm:flex [[data-collapsible=offcanvas][data-state=collapsed]_&]:pointer-events-none",
              "[[data-panel-animations=true]_&]:transition-all [[data-panel-animations=true]_&]:[transition-duration:var(--panel-animation-duration)] [[data-panel-animations=true]_&]:ease-out",
              "in-data-[side=left]:cursor-w-resize in-data-[side=right]:cursor-e-resize",
              "[[data-side=left][data-state=collapsed]_&]:cursor-e-resize [[data-side=right][data-state=collapsed]_&]:cursor-w-resize",
              "group-data-[collapsible=offcanvas]:translate-x-0",
              "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
              "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
              className,
            )}
            data-sidebar="rail"
            data-slot="sidebar-rail"
            onClick={handleClick}
            onLostPointerCapture={(event) => {
              onLostPointerCapture?.(event);
              resize.onLostPointerCapture(event);
            }}
            onPointerCancel={(event) => {
              onPointerCancel?.(event);
              resize.onPointerCancel(event);
            }}
            onPointerDown={(event) => {
              onPointerDown?.(event);
              // TooltipTrigger can preventDefault after the first press. Skipping
              // the drag hook then leaves the session open and blocks the next
              // resize.
              resize.onPointerDown(event);
            }}
            onPointerMove={(event) => {
              onPointerMove?.(event);
              resize.onPointerMove(event);
            }}
            onPointerUp={(event) => {
              onPointerUp?.(event);
              resize.onPointerUp(event);
            }}
            ref={railRef}
            tabIndex={-1}
            type="button"
            {...props}
          />
        }
      />
      <TooltipPopup side="right">{railTitle}</TooltipPopup>
    </Tooltip>
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return (
    <main
      className={cn(
        "relative flex min-w-0 w-full flex-1 flex-col bg-background surface-grain",
        "md:peer-data-[variant=inset]:peer-data-[state=collapsed]:ms-2 md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ms-0 md:peer-data-[variant=inset]:rounded-xl md:peer-data-[variant=inset]:shadow-sm/5",
        className,
      )}
      data-slot="sidebar-inset"
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2 p-2", className)}
      data-sidebar="header"
      data-slot="sidebar-header"
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col gap-2 p-2", className)}
      data-sidebar="footer"
      data-slot="sidebar-footer"
      {...props}
    />
  );
}

function SidebarContent({
  className,
  fixedHeader,
  ...props
}: React.ComponentProps<"div"> & {
  fixedHeader?: React.ReactNode;
}) {
  return (
    <>
      {fixedHeader ? <div className="w-full shrink-0">{fixedHeader}</div> : null}
      {/* Rows take focus on click. Scroll padding would make the browser nudge
          the list whenever a focused row sits under the fade. */}
      <ScrollArea
        hideScrollbars
        scrollFade
        scrollFadePadding={false}
        className="h-auto min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]]:[--fade-size:0.75rem]"
      >
        <div
          // Reordered rows must not pull the viewport to their new position.
          className={cn(
            "flex w-full min-w-0 flex-col gap-2 [overflow-anchor:none] group-data-[collapsible=icon]:overflow-hidden",
            className,
          )}
          data-sidebar="content"
          data-slot="sidebar-content"
          {...props}
        />
      </ScrollArea>
    </>
  );
}

function SidebarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative flex w-full min-w-0 flex-col p-[var(--sidebar-content-inset)]",
        className,
      )}
      data-sidebar="group"
      data-slot="sidebar-group"
      {...props}
    />
  );
}

function SidebarMenu({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn("flex w-full min-w-0 flex-col gap-1", className)}
      data-sidebar="menu"
      data-slot="sidebar-menu"
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      className={cn("group/menu-item relative", className)}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
      {...props}
    />
  );
}

const sidebarMenuButtonVariants = cva(
  "peer/menu-button flex w-full cursor-pointer items-center gap-[var(--sidebar-control-gap)] overflow-hidden text-left outline-hidden ring-ring transition-[width,height,padding] hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 active:bg-sidebar-row-active active:text-sidebar-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-row-selected data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground data-[state=open]:hover:bg-sidebar-row-hover data-[state=open]:hover:text-sidebar-foreground [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0 [&>svg]:text-[var(--sidebar-icon-color)] hover:[&>svg]:text-sidebar-foreground active:[&>svg]:text-sidebar-foreground data-[active=true]:[&>svg]:text-sidebar-foreground",
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      size: {
        default:
          "h-8 rounded-[var(--control-radius)] px-[var(--sidebar-row-content-inset)] py-1.5 text-sm group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-[var(--sidebar-content-inset)]!",
        icon: "size-8 justify-center rounded-[var(--control-radius)] p-0",
        lg: "h-12 rounded-lg p-2 text-sm group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-0!",
        sm: "h-7 rounded-lg p-2 text-xs group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-[var(--sidebar-content-inset)]!",
      },
      variant: {
        default: "font-medium text-sidebar-muted-foreground/80",
        outline: "bg-sidebar-control-surface ring-1 ring-sidebar-border",
      },
    },
  },
);

function SidebarMenuButton({
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  render,
  ...props
}: useRender.ComponentProps<"button"> & {
  isActive?: boolean;
  tooltip?: string | React.ComponentProps<typeof TooltipPopup>;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const { isMobile, state, peekFlyout } = useSidebar();

  const defaultProps = {
    className: cn(sidebarMenuButtonVariants({ size, variant }), className),
    "data-active": isActive,
    "data-sidebar": "menu-button",
    "data-size": size,
    "data-slot": "sidebar-menu-button",
  };

  const buttonProps = mergeProps<"button">(defaultProps, props);

  const buttonElement = useRender({
    defaultTagName: "button",
    props: buttonProps,
    render,
  });

  if (!tooltip) {
    return buttonElement;
  }

  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip,
    };
  }

  // Icon buttons never show a text label, so their tooltip stays available
  // while the sidebar is expanded. Labelled rows only need it when collapsed.
  const hideTooltip = size === "icon" ? isMobile : state !== "collapsed" || peekFlyout || isMobile;

  return (
    <Tooltip>
      <TooltipTrigger render={buttonElement as React.ReactElement<Record<string, unknown>>} />
      <TooltipPopup align="center" hidden={hideTooltip} side="right" {...tooltip} />
    </Tooltip>
  );
}

function SidebarMenuSub({ className, ...props }: React.ComponentProps<"ul">) {
  return (
    <ul
      className={cn(
        "mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-sidebar-border border-l px-2.5 py-0.5",
        "group-data-[collapsible=icon]:hidden",
        className,
      )}
      data-sidebar="menu-sub"
      data-slot="sidebar-menu-sub"
      {...props}
    />
  );
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<"li">) {
  return (
    <li
      className={cn("group/menu-sub-item relative", className)}
      data-sidebar="menu-sub-item"
      data-slot="sidebar-menu-sub-item"
      {...props}
    />
  );
}

function SidebarMenuSubButton({
  size = "md",
  isActive = false,
  className,
  render,
  ...props
}: useRender.ComponentProps<"a"> & {
  size?: "sm" | "md";
  isActive?: boolean;
}) {
  const defaultProps = {
    className: cn(
      "-translate-x-px flex h-7 min-w-0 cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 text-sidebar-foreground outline-hidden ring-ring hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 active:bg-sidebar-row-active active:text-sidebar-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&>span:last-child]:truncate [&>svg:not([class*='size-'])]:size-4 [&>svg]:shrink-0 [&>svg]:text-sidebar-muted-foreground",
      "data-[active=true]:bg-sidebar-row-selected data-[active=true]:text-sidebar-foreground",
      size === "sm" && "text-xs",
      size === "md" && "text-sm",
      "group-data-[collapsible=icon]:hidden",
      className,
    ),
    "data-active": isActive,
    "data-sidebar": "menu-sub-button",
    "data-size": size,
    "data-slot": "sidebar-menu-sub-button",
  };

  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(defaultProps, props),
    render,
  });
}

export type { SidebarResizableOptions };

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
  useSidebarVisibility,
};
