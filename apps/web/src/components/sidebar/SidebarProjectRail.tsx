import { FolderIcon, FolderOpenIcon, FolderPlusIcon, LayersIcon, PlusIcon } from "lucide-react";
import { lazy, Suspense, useState, type DragEvent, type MouseEvent, type ReactNode } from "react";
import type { IconName } from "lucide-react/dynamic";

import type { SidebarProjectFolder } from "@t3tools/contracts/settings";

import { openCommandPalette } from "../../commandPaletteBus";
import { cn } from "../../lib/utils";
import { projectIconColorClassName } from "../../projectIconColors";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectMonogram } from "../ProjectMonogram";
import {
  buildProjectRailItems,
  dataTransferHasRailProject,
  RAIL_PROJECT_DRAG_TYPE,
  type ProjectRailDropTarget,
  type SidebarProjectFolderSettings,
} from "../../sidebarProjectFolders";
import { ProjectFavicon } from "../ProjectFavicon";
import { resolveProjectStatusIndicator, type ProjectRailAttention } from "../Sidebar.logic";
import { SidebarMenuButton } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";

const openAddProject = () => openCommandPalette({ open: "add-project" });

const DynamicIcon = lazy(() =>
  import("lucide-react/dynamic").then((module) => ({ default: module.DynamicIcon })),
);

function FolderRailIcon({ folder }: { readonly folder: SidebarProjectFolder }) {
  const Fallback = folder.collapsed ? FolderIcon : FolderOpenIcon;
  if (folder.icon?.kind === "emoji") {
    return (
      <span
        aria-hidden
        className="inline-flex size-4 shrink-0 items-center justify-center leading-none [container-type:size]"
      >
        <span className="text-[length:80cqh] leading-none">{folder.icon.emoji}</span>
      </span>
    );
  }
  if (folder.icon?.kind === "monogram") {
    return <ProjectMonogram text={folder.icon.text} color={folder.icon.color} />;
  }
  if (folder.icon?.kind === "lucide") {
    const colorClassName = projectIconColorClassName(folder.icon.color);
    return (
      <span
        aria-hidden
        className={cn("inline-flex size-4 shrink-0 items-center justify-center", colorClassName)}
      >
        <Suspense fallback={<Fallback className="size-full" />}>
          <DynamicIcon name={folder.icon.name as IconName} className="size-full" />
        </Suspense>
      </span>
    );
  }
  return <Fallback />;
}

// Slides out from the rail; Base UI then skips this once the next icon is hovered.
const RAIL_TOOLTIP_CLASS =
  "max-w-72 transition-[width,height,scale,opacity,translate] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-starting-style:-translate-x-1 data-ending-style:-translate-x-1";

const COLLAPSED_ROW_BUTTON_CLASS =
  "aspect-auto h-9 w-full min-w-0 justify-start gap-2 px-1.5 group-data-[collapsible=icon]:size-auto! group-data-[collapsible=icon]:h-9! group-data-[collapsible=icon]:w-full! group-data-[collapsible=icon]:p-0! group-data-[collapsible=icon]:px-1.5!";

const EMPTY_FOLDER_SETTINGS: SidebarProjectFolderSettings = { folders: [], assignments: {} };
const RAIL_DROP_HIGHLIGHT_CLASS = "bg-sidebar-row-hover ring-1 ring-ring/80";

function railDragTypes(event: DragEvent): readonly string[] {
  return event.dataTransfer === null ? [] : Array.from(event.dataTransfer.types);
}

function projectRailEnvironmentLine(project: SidebarProjectSnapshot): string | null {
  if (project.remoteEnvironmentLabels.length === 0) return null;
  const labels = project.remoteEnvironmentLabels.join(", ");
  return project.environmentPresence === "mixed" ? `Also on ${labels}` : `On ${labels}`;
}

function visibleProjectJumpNumbers(
  items: ReturnType<typeof buildProjectRailItems<SidebarProjectSnapshot>>,
): ReadonlyMap<string, number> {
  const jumpByProjectKey = new Map<string, number>();
  let jump = 0;
  for (const item of items) {
    const visible =
      item.kind === "project" ? [item.project] : item.folder.collapsed ? [] : item.projects;
    for (const project of visible) {
      jump += 1;
      if (jump <= 9) jumpByProjectKey.set(project.projectKey, jump);
    }
  }
  return jumpByProjectKey;
}

function folderRailAttention(
  projects: readonly SidebarProjectSnapshot[],
  attentionByProjectKey?: ReadonlyMap<string, ProjectRailAttention>,
): ProjectRailAttention | null {
  let result: ProjectRailAttention | undefined;
  for (const project of projects) {
    const next = attentionByProjectKey?.get(project.projectKey);
    if (!next) continue;
    if (result === undefined) {
      result = next;
      continue;
    }
    const strongest = resolveProjectStatusIndicator([result, next]) ?? next;
    result = { ...strongest, count: result.count + next.count };
  }
  return result ?? null;
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

function FolderRailTooltip({
  name,
  projects,
  collapsed,
  attention,
}: {
  name: string;
  projects: readonly SidebarProjectSnapshot[];
  collapsed: boolean;
  attention: ProjectRailAttention | null;
}): ReactNode {
  return (
    <span className="flex min-w-0 w-full flex-col gap-0.5 py-0.5 text-left">
      <span className="min-w-0 w-full font-medium">{name}</span>
      <span className="text-muted-foreground">
        {projects.length} {projects.length === 1 ? "project" : "projects"}
        {collapsed ? " · collapsed" : ""}
      </span>
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
  jumpNumber,
  selected,
  attention,
  docked,
  onSelectProject,
  onNewThreadInProject,
  onProjectContextMenu,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
}: {
  project: SidebarProjectSnapshot;
  jumpNumber: number | null;
  selected: boolean;
  attention: ProjectRailAttention | null;
  docked: boolean;
  onSelectProject: (project: SidebarProjectSnapshot) => void;
  onNewThreadInProject?: ((project: SidebarProjectSnapshot) => void) | undefined;
  onProjectContextMenu?:
    | ((event: MouseEvent<HTMLElement>, project: SidebarProjectSnapshot) => void)
    | undefined;
  draggable?: boolean;
  dragging?: boolean;
  onDragStart?: ((event: DragEvent<HTMLDivElement>) => void) | undefined;
  onDragEnd?: (() => void) | undefined;
}) {
  const label = [project.displayName, ...project.remoteEnvironmentLabels].join(" · ");
  return (
    <div
      className={cn(
        "group/rail-item relative min-w-0 shrink-0",
        !docked && "w-full",
        draggable && "cursor-grab",
        dragging && "opacity-50",
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
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
          draggable={false}
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
  folders = EMPTY_FOLDER_SETTINGS,
  onToggleFolder,
  onFolderContextMenu,
  onApplyDrop,
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
  folders?: SidebarProjectFolderSettings;
  onToggleFolder?: (folderId: string) => void;
  onFolderContextMenu?: (event: MouseEvent<HTMLElement>, folder: SidebarProjectFolder) => void;
  onApplyDrop?: (projectKey: string, target: ProjectRailDropTarget) => void;
}) {
  const docked = variant === "docked";
  const items = buildProjectRailItems(projects, folders);
  const jumpByProjectKey = visibleProjectJumpNumbers(items);
  const [draggingProjectKey, setDraggingProjectKey] = useState<string | null>(null);
  const [dropHighlight, setDropHighlight] = useState<string | null>(null);
  const canDrag = onApplyDrop !== undefined && folders.folders.length > 0;

  const acceptRailDrag = (event: DragEvent) => {
    if (draggingProjectKey === null && !dataTransferHasRailProject(railDragTypes(event))) {
      return false;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    return true;
  };

  const finishDrop = (event: DragEvent, target: ProjectRailDropTarget) => {
    event.preventDefault();
    event.stopPropagation();
    const projectKey = draggingProjectKey ?? event.dataTransfer?.getData(RAIL_PROJECT_DRAG_TYPE);
    if (projectKey !== undefined && projectKey.length > 0) onApplyDrop?.(projectKey, target);
    setDraggingProjectKey(null);
    setDropHighlight(null);
  };

  const highlightUngrouped = (highlight: "all" | "list") => (event: DragEvent<HTMLElement>) => {
    if (!acceptRailDrag(event)) return;
    setDropHighlight(highlight);
  };
  const dropUngrouped = (event: DragEvent<HTMLElement>) => {
    finishDrop(event, { kind: "ungrouped" });
  };

  const renderProject = (project: SidebarProjectSnapshot) => (
    <ProjectRailItem
      key={project.projectKey}
      project={project}
      jumpNumber={jumpByProjectKey.get(project.projectKey) ?? null}
      selected={selectedProjectKey === project.projectKey}
      attention={attentionByProjectKey?.get(project.projectKey) ?? null}
      docked={docked}
      onSelectProject={onSelectProject}
      onNewThreadInProject={onNewThreadInProject}
      onProjectContextMenu={onProjectContextMenu}
      draggable={canDrag}
      dragging={draggingProjectKey === project.projectKey}
      onDragStart={(event) => {
        event.dataTransfer.setData(RAIL_PROJECT_DRAG_TYPE, project.projectKey);
        event.dataTransfer.setData("text/plain", project.projectKey);
        event.dataTransfer.effectAllowed = "move";
        setDraggingProjectKey(project.projectKey);
      }}
      onDragEnd={() => {
        setDraggingProjectKey(null);
        setDropHighlight(null);
      }}
    />
  );

  const railItems = items.map((item) => {
    if (item.kind === "project") return renderProject(item.project);

    const attention = folderRailAttention(item.projects, attentionByProjectKey);
    const containsSelected = item.projects.some(
      (project) => project.projectKey === selectedProjectKey,
    );
    return (
      <div
        key={item.folder.id}
        className={cn(
          "min-w-0 rounded-lg bg-sidebar-control-surface/50",
          docked ? "flex flex-col items-center gap-1 py-0.5" : "flex w-full flex-col gap-1 p-0.5",
          dropHighlight === `folder:${item.folder.id}` && RAIL_DROP_HIGHLIGHT_CLASS,
        )}
        onDragOver={(event) => {
          if (!acceptRailDrag(event)) return;
          event.stopPropagation();
          setDropHighlight(`folder:${item.folder.id}`);
        }}
        onDrop={(event) => finishDrop(event, { kind: "folder", folderId: item.folder.id })}
      >
        <div className="relative min-w-0 w-full shrink-0">
          <SidebarMenuButton
            size={docked ? "icon" : "tile"}
            aria-label={`${item.folder.collapsed ? "Expand" : "Collapse"} ${item.folder.name}`}
            aria-expanded={!item.folder.collapsed}
            tooltip={{
              className: RAIL_TOOLTIP_CLASS,
              sideOffset: 8,
              children: (
                <FolderRailTooltip
                  name={item.folder.name}
                  projects={item.projects}
                  collapsed={item.folder.collapsed}
                  attention={attention}
                />
              ),
            }}
            isActive={containsSelected && item.folder.collapsed}
            className={docked ? undefined : COLLAPSED_ROW_BUTTON_CLASS}
            onClick={() => onToggleFolder?.(item.folder.id)}
            onContextMenu={
              onFolderContextMenu ? (event) => onFolderContextMenu(event, item.folder) : undefined
            }
          >
            {!docked ? <span className="w-3.5 shrink-0" aria-hidden /> : null}
            <FolderRailIcon folder={item.folder} />
          </SidebarMenuButton>
          {item.folder.collapsed && attention ? (
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
        </div>
        {item.folder.collapsed ? null : item.projects.map(renderProject)}
      </div>
    );
  });

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
        onDragLeave={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          setDropHighlight(null);
        }}
      >
        {onSelectAll ? (
          <SidebarMenuButton
            size={docked ? "icon" : "tile"}
            aria-label="All projects"
            tooltip={{ className: RAIL_TOOLTIP_CLASS, children: "All projects" }}
            isActive={selectedProjectKey === null}
            aria-pressed={selectedProjectKey === null}
            className={cn(
              docked ? undefined : COLLAPSED_ROW_BUTTON_CLASS,
              dropHighlight === "all" && RAIL_DROP_HIGHLIGHT_CLASS,
            )}
            onClick={onSelectAll}
            onDragOver={highlightUngrouped("all")}
            onDrop={dropUngrouped}
          >
            {!docked ? <span className="w-3.5 shrink-0" aria-hidden /> : null}
            <LayersIcon />
          </SidebarMenuButton>
        ) : null}
        <div
          className={cn(
            "flex min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden py-1",
            docked ? "items-center gap-1.5" : "items-stretch gap-1",
            dropHighlight === "list" && "rounded-lg",
            dropHighlight === "list" && RAIL_DROP_HIGHLIGHT_CLASS,
          )}
          onDragOver={highlightUngrouped("list")}
          onDrop={dropUngrouped}
        >
          {railItems}
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
