import { FolderPlusIcon, LayersIcon, PlusIcon } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { cn } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";
import type { ProjectRailAttention } from "../Sidebar.logic";
import { SidebarMenuButton } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";

const openAddProject = () => openCommandPalette({ open: "add-project" });

// Slides out from the rail; Base UI then skips this once the next icon is hovered.
const RAIL_TOOLTIP_CLASS =
  "max-w-72 transition-[width,height,scale,opacity,translate] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-starting-style:-translate-x-1 data-ending-style:-translate-x-1";

const COLLAPSED_ROW_BUTTON_CLASS =
  "aspect-auto h-9 w-full min-w-0 justify-start gap-2 px-1.5 group-data-[collapsible=icon]:size-auto! group-data-[collapsible=icon]:h-9! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:px-1.5!";

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
    <div className="group/rail-item relative min-w-0 w-full shrink-0">
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
        className={docked ? undefined : COLLAPSED_ROW_BUTTON_CLASS}
        onClick={() => onSelectProject(project)}
        onContextMenu={
          onProjectContextMenu ? (event) => onProjectContextMenu(event, project) : undefined
        }
      >
        {!docked ? (
          <span
            aria-hidden
            className="w-3.5 shrink-0 text-center font-mono text-[10px] font-semibold tabular-nums text-sidebar-muted-foreground"
          >
            {jumpNumber ?? ""}
          </span>
        ) : null}
        <ProjectFavicon
          project={project}
          className={docked ? "size-4 shrink-0" : "size-5 shrink-0"}
        />
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
            docked ? "-right-0.5 -top-0.5" : "right-1 top-1",
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
            docked ? "-bottom-1 -right-1" : "right-1.5 top-1/2 -translate-y-1/2",
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
 * entry shows every project. `docked` sits beside the list; `collapsed` is a
 * single-column project switcher that fills the traffic-light-wide icon rail.
 * Search and new-thread live on the peeked/expanded thread list, not here.
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
  return (
    <TooltipProvider delay={150} closeDelay={0} timeout={400}>
      <nav
        aria-label="Projects"
        className={cn(
          "flex min-h-0 flex-col",
          docked
            ? "w-12 shrink-0 items-center gap-1.5 border-r border-sidebar-border/60 py-2"
            : "flex-1 items-stretch gap-1 px-1.5 py-1.5",
        )}
      >
        {onSelectAll ? (
          <SidebarMenuButton
            size={docked ? "icon" : "tile"}
            aria-label="All projects"
            tooltip={{ className: RAIL_TOOLTIP_CLASS, children: "All projects" }}
            isActive={selectedProjectKey === null}
            aria-pressed={selectedProjectKey === null}
            className={docked ? undefined : COLLAPSED_ROW_BUTTON_CLASS}
            onClick={onSelectAll}
          >
            {!docked ? <span className="w-3.5 shrink-0" aria-hidden /> : null}
            <LayersIcon />
          </SidebarMenuButton>
        ) : null}
        <div
          className={cn(
            "flex min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden py-1",
            docked ? "items-center gap-1.5" : "items-stretch gap-1",
          )}
        >
          {projects.map((project, index) => (
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
          ))}
        </div>
        <SidebarMenuButton
          size={docked ? "icon" : "tile"}
          aria-label="Add project"
          tooltip={{ className: RAIL_TOOLTIP_CLASS, children: "Add project" }}
          className={docked ? undefined : COLLAPSED_ROW_BUTTON_CLASS}
          onClick={openAddProject}
        >
          {!docked ? <span className="w-3.5 shrink-0" aria-hidden /> : null}
          <FolderPlusIcon />
        </SidebarMenuButton>
      </nav>
    </TooltipProvider>
  );
}
