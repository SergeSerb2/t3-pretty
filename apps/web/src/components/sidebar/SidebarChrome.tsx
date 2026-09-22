import { ArrowLeftIcon, ChartNoAxesColumnIcon, SettingsIcon } from "lucide-react";
import type { ReactNode } from "react";
import { memo, useCallback } from "react";
import { Link, useCanGoBack, useLocation, useNavigate } from "@tanstack/react-router";

import { useEnvironmentIdentificationMode } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useEnvironments } from "../../state/environments";
import { persistedPullRequestListSearch } from "../pullRequest/pullRequestListFiltersPersistence";
import {
  resolveEnvironmentIdentificationPillLabel,
  resolveSidebarStageBackdropVariant,
  resolveSidebarStageFocusRingOffsetClass,
  SidebarStageBackdrop,
  useEnvironmentStageLabel,
} from "../SidebarStageBackdrop";
import { Badge } from "../ui/badge";
import {
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { readPullRequestListPreferences } from "../pullRequest/pullRequestListPreferences";
import { SidebarThreadUndoNotice } from "./SidebarThreadUndoNotice";
import { SidebarProviderUpdatePill } from "./SidebarProviderUpdatePill";
import { SidebarUpdateArchitectureWarning, SidebarUpdatePill } from "./SidebarUpdatePill";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";

export const SidebarChromeHeader = memo(function SidebarChromeHeader({
  isElectron,
}: {
  isElectron: boolean;
}) {
  const stageLabel = useEnvironmentStageLabel();
  const environmentIdentificationMode = useEnvironmentIdentificationMode();
  const backdropVariant = resolveSidebarStageBackdropVariant(
    stageLabel,
    environmentIdentificationMode === "artwork",
  );
  const pillLabel =
    environmentIdentificationMode === "pill"
      ? resolveEnvironmentIdentificationPillLabel(stageLabel)
      : null;

  return (
    <SidebarHeader
      className={cn(
        "@container/sidebar-header relative h-[var(--workspace-topbar-height)] shrink-0 flex-row items-center px-3 py-0 md:px-0",
        isElectron && "drag-region",
      )}
    >
      {backdropVariant ? <SidebarStageBackdrop variant={backdropVariant} /> : null}
      <SidebarTrigger
        className={cn(
          "relative z-10 md:hidden",
          backdropVariant &&
            "focus-visible:ring-white/90 [&_svg]:stroke-white/90! [&_svg]:opacity-100! [&_svg]:hover:stroke-white! [:hover,[data-pressed]]:bg-white/15",
          backdropVariant && resolveSidebarStageFocusRingOffsetClass(backdropVariant),
        )}
      />
      <SidebarBrand onBackdrop={backdropVariant !== null} />
      {pillLabel ? (
        // The wrapper carries the hiding: Badge's own `inline-flex` utility
        // outranks the components-layer `sidebar-brand-stage` display rules,
        // so the class has to live on an element without a display utility.
        <span
          className="sidebar-brand-stage relative z-10 ml-1 items-center"
          data-sidebar-peek="label"
        >
          <Badge
            className="rounded-full px-1.5 text-muted-foreground"
            data-environment-identification="pill"
            size="sm"
            variant="secondary"
          >
            {pillLabel}
          </Badge>
        </span>
      ) : null}
    </SidebarHeader>
  );
});

// The mark stays on the resting icon rail; only the wordmark folds away. The
// link's margin and the word's grid track are owned by `index.css` so the
// collapse can transition them, since utilities would outrank the components
// layer.
function SidebarBrand({ onBackdrop }: { onBackdrop: boolean }) {
  return (
    <Link
      aria-label="Go to threads"
      className={cn(
        "relative z-10 hidden h-7 w-fit min-w-0 shrink-0 items-center overflow-hidden rounded-md outline-hidden ring-ring focus-visible:ring-2 md:flex",
        onBackdrop ? "text-white" : "text-foreground",
      )}
      data-sidebar-brand=""
      to="/"
    >
      <img
        alt=""
        aria-hidden="true"
        className={cn(
          "h-5 w-7 shrink-0 object-contain",
          // The sage mark carries the brand on plain chrome in both themes. Over
          // scenery photo backdrops it washes out, so fall back to a white glyph.
          onBackdrop && "brightness-0 invert",
        )}
        src="/t3-pretty-mark.png"
      />
      {/* Trim only the cap edge. Trimming the alphabetic baseline clips the y in Pretty. */}
      <span
        className={cn(
          "grid min-w-0 overflow-hidden text-sm font-medium leading-none tracking-tight",
          onBackdrop ? "text-white/70" : "text-muted-foreground",
        )}
        data-sidebar-brand-word=""
      >
        <span className="min-w-0 truncate pl-1 [text-box:trim-start_cap]">Pretty</span>
      </span>
    </Link>
  );
}

type SidebarUtilityMenuOrientation = "horizontal" | "vertical";

function SidebarUtilityItem({
  icon,
  label,
  onClick,
  tooltipSide,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tooltipSide: "top" | "right";
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label={label}
              data-animate-ui-icons
              onClick={onClick}
              size="icon"
            >
              {icon}
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side={tooltipSide}>{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}

/**
 * Settings, pull requests, usage and the desktop update control. `vertical`
 * is the icon column pinned under the project rail, identical whether the
 * sidebar is icon-only or expanded, so nothing moves when it opens.
 * `horizontal` is the footer row of sidebars without a rail; it folds into a
 * column on its own when that sidebar collapses to icons.
 */
export const SidebarUtilityMenu = memo(function SidebarUtilityMenu({
  orientation = "horizontal",
}: {
  orientation?: SidebarUtilityMenuOrientation;
}) {
  const vertical = orientation === "vertical";
  const tooltipSide = vertical ? "right" : "top";
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  const { isMobile, setOpenMobile } = useSidebar();
  const currentFooterPage = useLocation({
    select: (location) =>
      /^\/settings(?:\/|$)/.test(location.pathname)
        ? "settings"
        : /^\/projects\/[^/]+\/?$/.test(location.pathname)
          ? "project-settings"
          : location.pathname.startsWith("/automations/")
            ? "automations"
            : location.pathname === "/usage"
              ? "usage"
              : location.pathname === "/pull-requests"
                ? "pull-requests"
                : null,
  });
  const { environments } = useEnvironments();
  // The page reads every connected server, so one of them offering pull requests is enough for
  // the link to lead somewhere.
  const pullRequestsSupported = environments.some(
    (environment) => environment.serverConfig?.environment.capabilities.pullRequests === true,
  );
  const closeMobileSidebar = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
  }, [isMobile, setOpenMobile]);
  const handlePullRequestsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({
      to: "/pull-requests",
      search: readPullRequestListPreferences(),
    });
  }, [closeMobileSidebar, navigate]);
  const handleSettingsClick = useCallback(() => {
    closeMobileSidebar();
    void navigate({ to: "/settings" });
  }, [closeMobileSidebar, navigate]);

  const handleUsageClick = useCallback(() => {
    if (isMobile) {
      setOpenMobile(false);
    }
    void navigate({ to: "/usage" });
  }, [isMobile, navigate, setOpenMobile]);

  const handleBackClick = useCallback(() => {
    closeMobileSidebar();
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  }, [canGoBack, closeMobileSidebar, navigate]);

  return (
    <SidebarMenu
      className={cn(
        "items-center",
        vertical
          ? "w-auto flex-col gap-0.5 [&>li]:ml-0"
          : "flex-row group-data-[collapsible=icon]:w-auto group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:gap-0.5 group-data-[collapsible=icon]:[&>li]:ml-0",
      )}
    >
      {currentFooterPage ? (
        vertical ? (
          <SidebarUtilityItem
            icon={<ArrowLeftIcon />}
            label="Back"
            onClick={handleBackClick}
            tooltipSide={tooltipSide}
          />
        ) : (
          <SidebarMenuItem className="min-w-0 flex-1">
            <SidebarMenuButton onClick={handleBackClick} aria-label="Back" tooltip="Back">
              <ArrowLeftIcon />
              <span className="group-data-[collapsible=icon]:hidden">Back</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )
      ) : (
        <>
          <SidebarUtilityItem
            icon={<SettingsIcon />}
            label="Settings"
            onClick={handleSettingsClick}
            tooltipSide={tooltipSide}
          />
          {pullRequestsSupported ? (
            <SidebarUtilityItem
              icon={<PullRequestGlyph.pullRequest />}
              label="Pull Requests"
              onClick={handlePullRequestsClick}
              tooltipSide={tooltipSide}
            />
          ) : null}
          <SidebarUtilityItem
            icon={<ChartNoAxesColumnIcon />}
            label="Usage"
            onClick={handleUsageClick}
            tooltipSide={tooltipSide}
          />
        </>
      )}
      <SidebarUpdatePill />
    </SidebarMenu>
  );
});

/**
 * Update notices above the thread list. Utilities live in the project rail
 * (`SidebarUtilityMenu` vertical); sidebars without a rail pass their own row
 * as children. Collapses to nothing so an idle footer adds no padding.
 */
export const SidebarChromeFooter = memo(function SidebarChromeFooter({
  children,
}: {
  children?: ReactNode;
}) {
  return (
    <SidebarFooter className="px-[var(--sidebar-content-inset)] py-1 empty:hidden">
      <SidebarThreadUndoNotice />
      <SidebarProviderUpdatePill />
      <SidebarUpdateArchitectureWarning />
      {children}
    </SidebarFooter>
  );
});
