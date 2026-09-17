import { FolderPlusIcon, LayersIcon, PlusIcon, SearchIcon, SquarePenIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { cn } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";
import type { ProjectRailAttention } from "../Sidebar.logic";
import { SidebarMenuButton } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";
import {
  COLLAPSED_DOCK_BAR_BUTTON_CLASS,
  COLLAPSED_DOCK_CONTAINER_CLASS,
  COLLAPSED_DOCK_GRID_CLASS,
  COLLAPSED_DOCK_WIDE_LABEL_CLASS,
} from "./collapsedSidebarDock";

const openNewThreadPicker = () => openCommandPalette({ open: "new-thread-in" });
const openAddProject = () => openCommandPalette({ open: "add-project" });

// Slides out from the rail; Base UI then skips this once the next icon is hovered.
const RAIL_TOOLTIP_CLASS =
  "max-w-72 transition-[width,height,scale,opacity,translate] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-starting-style:-translate-x-1 data-ending-style:-translate-x-1";

function projectRailEnvironmentLine(project: SidebarProjectSnapshot): string | null {
  if (project.remoteEnvironmentLabels.length === 0) return null;
  const labels = project.remoteEnvironmentLabels.join(", ");
  return project.environmentPresence === "mixed" ? `Also on ${labels}` : `On ${labels}`;
}

function ProjectRailTooltip({
  project,
  attention,
}: {
  project: SidebarProjectSnapshot;
  attention: ProjectRailAttention | null;
}): ReactNode {
  const environmentLine = projectRailEnvironmentLine(project);
  return (
    <span className="flex min-w-0 w-full flex-col gap-0.5 py-0.5 text-left">
      <span className="min-w-0 w-full font-medium">{project.displayName}</span>
      <span className="min-w-0 w-full truncate text-muted-foreground">{project.workspaceRoot}</span>
      {environmentLine ? <span className="text-muted-foreground">{environmentLine}</span> : null}
      {project.groupedProjectCount > 1 ? (
        <span className="text-muted-foreground">{project.groupedProjectCount} projects</span>
      ) : null}
      {attention ? (
        <span className={attention.colorClass}>
          {attention.label}
          {attention.count > 1 ? ` · ${attention.count}` : ""}
        </span>
      ) : null}
    </span>
  );
}

function ProjectRailItem({
  project,
  index,
  selected,
  attention,
  docked,
  onSelectProject,
  onNewThreadInProject,
  onProjectContextMenu,
}: {
  project: SidebarProjectSnapshot;
  index: number;
  selected: boolean;
  attention: ProjectRailAttention | null;
  docked: boolean;
  onSelectProject: (project: SidebarProjectSnapshot) => void;
  onNewThreadInProject?: (project: SidebarProjectSnapshot) => void;
  onProjectContextMenu?: (event: MouseEvent<HTMLElement>, project: SidebarProjectSnapshot) => void;
}) {
  const label = [project.displayName, ...project.remoteEnvironmentLabels].join(" · ");
  const jumpNumber = index < 9 ? index + 1 : null;
  return (
    <div className="group/rail-item relative min-w-0 shrink-0">
      <SidebarMenuButton
        size={docked ? "icon" : "tile"}
        aria-label={`Show ${label} threads`}
        tooltip={{
          className: RAIL_TOOLTIP_CLASS,
          sideOffset: 8,
          children: <ProjectRailTooltip project={project} attention={attention} />,
        }}
        isActive={selected}
        aria-pressed={selected}
        className={docked ? undefined : "flex-col gap-0.5"}
        onClick={() => onSelectProject(project)}
        onContextMenu={
          onProjectContextMenu ? (event) => onProjectContextMenu(event, project) : undefined
        }
      >
        <ProjectFavicon
          project={project}
          className={docked ? "size-4 shrink-0" : "size-5 shrink-0"}
        />
        {!docked && jumpNumber !== null ? (
          <span
            aria-hidden
            className="font-mono text-[9px] font-semibold leading-none tabular-nums text-sidebar-muted-foreground"
          >
            {jumpNumber}
          </span>
        ) : null}
      </SidebarMenuButton>
      {docked && jumpNumber !== null ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -bottom-0.5 -left-0.5 z-10 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-sm border border-border/80 bg-background/95 px-0.5 font-mono text-[9px] font-semibold tabular-nums text-foreground shadow-sm"
        >
          {jumpNumber}
        </span>
      ) : null}
      {attention ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute z-10 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 font-mono text-[9px] font-semibold tabular-nums text-white ring-2 ring-sidebar",
            docked ? "-right-0.5 -top-0.5" : "right-0.5 top-0.5",
            attention.dotClass,
          )}
        >
          {attention.count}
        </span>
      ) : null}
      {onNewThreadInProject ? (
        <button
          type="button"
          aria-label={`New thread in ${project.displayName}`}
          onClick={(event) => {
            event.stopPropagation();
            onNewThreadInProject(project);
          }}
          className={cn(
            "absolute z-10 flex size-4 cursor-pointer items-center justify-center rounded-full bg-sidebar-control-surface text-sidebar-foreground opacity-0 ring-1 ring-sidebar-border transition-opacity hover:bg-sidebar-row-hover focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-ring group-hover/rail-item:opacity-100",
            docked ? "-bottom-1 -right-1" : "left-0.5 top-0.5",
          )}
        >
          <PlusIcon className="size-2.5" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Vertical strip of project icons. The rail is the only project axis in the
 * sidebar: picking an icon scopes the thread list to that project, the top
 * entry shows every project. `docked` renders beside the list; `collapsed`
 * stands in for the whole sidebar and fills the traffic-light-wide icon rail.
 */
export function SidebarProjectRail({
  variant = "collapsed",
  projects,
  selectedProjectKey,
  onSelectProject,
  onSelectAll,
  attentionByProjectKey,
  onNewThreadInProject,
  onProjectContextMenu,
  onNewThread = openNewThreadPicker,
}: {
  variant?: "docked" | "collapsed";
  projects: readonly SidebarProjectSnapshot[];
  selectedProjectKey: string | null;
  onSelectProject: (project: SidebarProjectSnapshot) => void;
  onSelectAll?: () => void;
  /** Strongest waiting-on-you / finished-PR status, plus a count, per project. */
  attentionByProjectKey?: ReadonlyMap<string, ProjectRailAttention>;
  onNewThreadInProject?: (project: SidebarProjectSnapshot) => void;
  onProjectContextMenu?: (event: MouseEvent<HTMLElement>, project: SidebarProjectSnapshot) => void;
  onNewThread?: (event: MouseEvent) => void;
}) {
  const docked = variant === "docked";
  const projectItems = projects.map((project, index) => (
    <ProjectRailItem
      key={project.projectKey}
      project={project}
      index={index}
      selected={selectedProjectKey === project.projectKey}
      attention={attentionByProjectKey?.get(project.projectKey) ?? null}
      docked={docked}
      onSelectProject={onSelectProject}
      onNewThreadInProject={onNewThreadInProject}
      onProjectContextMenu={onProjectContextMenu}
    />
  ));

  return (
    <TooltipProvider delay={150} closeDelay={0} timeout={400}>
      <nav
        aria-label="Projects"
        className={cn(
          "flex min-h-0 flex-col",
          docked
            ? "w-12 shrink-0 items-center gap-1.5 border-r border-sidebar-border/60 py-2"
            : cn(COLLAPSED_DOCK_CONTAINER_CLASS, "flex-1 gap-1 px-1 py-1.5"),
        )}
      >
        {docked ? (
          <>
            {onSelectAll ? (
              <SidebarMenuButton
                size="icon"
                aria-label="All projects"
                tooltip={{ className: RAIL_TOOLTIP_CLASS, children: "All projects" }}
                isActive={selectedProjectKey === null}
                aria-pressed={selectedProjectKey === null}
                onClick={onSelectAll}
              >
                <LayersIcon />
              </SidebarMenuButton>
            ) : null}
            <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden py-1">
              {projectItems}
            </div>
            <SidebarMenuButton
              size="icon"
              aria-label="Add project"
              tooltip={{ className: RAIL_TOOLTIP_CLASS, children: "Add project" }}
              onClick={openAddProject}
            >
              <FolderPlusIcon />
            </SidebarMenuButton>
          </>
        ) : (
          <>
            <div className={COLLAPSED_DOCK_GRID_CLASS}>
              <SidebarMenuButton
                size="tile"
                aria-label="Search threads"
                tooltip={{ className: RAIL_TOOLTIP_CLASS, children: "Search threads" }}
                onClick={() => openCommandPalette()}
              >
                <SearchIcon />
              </SidebarMenuButton>
              <SidebarMenuButton
                size="tile"
                aria-label="New thread"
                tooltip={{ className: RAIL_TOOLTIP_CLASS, children: "New thread" }}
                disabled={projects.length === 0}
                onClick={onNewThread}
              >
                <SquarePenIcon />
              </SidebarMenuButton>
              {onSelectAll ? (
                <SidebarMenuButton
                  size="tile"
                  aria-label="All projects"
                  tooltip={{ className: RAIL_TOOLTIP_CLASS, children: "All projects" }}
                  isActive={selectedProjectKey === null}
                  aria-pressed={selectedProjectKey === null}
                  className={COLLAPSED_DOCK_BAR_BUTTON_CLASS}
                  onClick={onSelectAll}
                >
                  <LayersIcon />
                  <span className={COLLAPSED_DOCK_WIDE_LABEL_CLASS}>All</span>
                </SidebarMenuButton>
              ) : null}
            </div>
            <div
              className={cn(
                COLLAPSED_DOCK_GRID_CLASS,
                "min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-0.5",
              )}
            >
              {projectItems}
            </div>
            <SidebarMenuButton
              size="tile"
              aria-label="Add project"
              tooltip={{ className: RAIL_TOOLTIP_CLASS, children: "Add project" }}
              className={COLLAPSED_DOCK_BAR_BUTTON_CLASS}
              onClick={openAddProject}
            >
              <FolderPlusIcon />
              <span className={COLLAPSED_DOCK_WIDE_LABEL_CLASS}>Add</span>
            </SidebarMenuButton>
          </>
        )}
      </nav>
    </TooltipProvider>
  );
}
