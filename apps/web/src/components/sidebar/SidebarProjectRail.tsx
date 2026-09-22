import { FolderIcon, FolderOpenIcon, FolderPlusIcon, LayersIcon, PlusIcon } from "lucide-react";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { IconName } from "lucide-react/dynamic";

import "./projectRailFolder.css";

import type { SidebarProjectFolder } from "@t3tools/contracts/settings";

import { openCommandPalette } from "../../commandPaletteBus";
import { cn } from "../../lib/utils";
import { projectIconColorClassName } from "../../projectIconColors";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectMonogram } from "../ProjectMonogram";
import {
  buildProjectRailItems,
  dataTransferHasRailFolder,
  dataTransferHasRailProject,
  folderDropBeforeId,
  RAIL_FOLDER_DRAG_TYPE,
  RAIL_PROJECT_DRAG_TYPE,
  type ProjectRailDropTarget,
  type SidebarProjectFolderSettings,
} from "../../sidebarProjectFolders";
import { ProjectFavicon } from "../ProjectFavicon";
import {
  formatProjectRailActivity,
  mergeProjectRailActivity,
  projectRailActivityMark,
  resolveProjectStatusIndicator,
  type ProjectRailActivity,
  type ProjectRailAttention,
} from "../Sidebar.logic";
import { SidebarMenuButton } from "../ui/sidebar";
import { TooltipProvider } from "../ui/tooltip";

const openAddProject = () => openCommandPalette({ open: "add-project" });

const DynamicIcon = lazy(() =>
  import("lucide-react/dynamic").then((module) => ({ default: module.DynamicIcon })),
);

function FolderRailGlyph({ folder }: { readonly folder: SidebarProjectFolder }) {
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
  return (
    <span aria-hidden className="rail-folder-glyph" data-open={folder.collapsed ? "false" : "true"}>
      <FolderIcon className="rail-folder-glyph-closed size-4" />
      <FolderOpenIcon className="rail-folder-glyph-open size-4" />
    </span>
  );
}

type RailFolderDrop = "in" | "before" | "after" | null;

/** Unclip badges after the well finishes growing. 320ms covers the 200ms open. */
const RAIL_FOLDER_SETTLE_MS = 320;

function useFolderTraySettled(open: boolean): {
  readonly settled: boolean;
  readonly projectsRef: RefObject<HTMLDivElement | null>;
} {
  const projectsRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState(() => ({ open, settled: open }));
  if (phase.open !== open) {
    setPhase({ open, settled: false });
  }
  const settled = phase.settled && phase.open === open;

  useEffect(() => {
    if (!open || settled) return;
    const node = projectsRef.current;
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      cancelled = true;
      setPhase((current) => (current.open ? { open: true, settled: true } : current));
    };
    const timeout = window.setTimeout(finish, RAIL_FOLDER_SETTLE_MS);
    const onEnd = (event: TransitionEvent) => {
      if (node === null || event.target !== node || event.propertyName !== "grid-template-rows") {
        return;
      }
      window.clearTimeout(timeout);
      finish();
    };
    node?.addEventListener("transitionend", onEnd);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      node?.removeEventListener("transitionend", onEnd);
    };
  }, [open, settled]);

  return { settled, projectsRef };
}

function RailFolderFrame({
  open,
  drop,
  dragging,
  onDragOver,
  onDrop,
  button,
  projects,
}: {
  readonly open: boolean;
  readonly drop: RailFolderDrop;
  readonly dragging: boolean;
  readonly onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly button: ReactNode;
  readonly projects: ReactNode;
}) {
  const { settled, projectsRef } = useFolderTraySettled(open);
  return (
    <div
      data-open={open ? "true" : "false"}
      data-settled={settled ? "true" : "false"}
      data-drop={drop ?? undefined}
      className={cn(
        "rail-folder-tray relative isolate flex w-8 shrink-0 flex-col items-center",
        dragging && "opacity-50",
        drop === "before" && RAIL_FOLDER_BEFORE_CLASS,
        drop === "after" && RAIL_FOLDER_AFTER_CLASS,
      )}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        aria-hidden
        className="rail-folder-tray-bg pointer-events-none absolute inset-0 rounded-[var(--control-radius)] bg-[color-mix(in_srgb,var(--sidebar-foreground)_12%,var(--sidebar))]"
      />
      <div className="relative z-[1] w-full">{button}</div>
      <div
        ref={projectsRef}
        className="rail-folder-projects relative z-[1]"
        inert={!open}
        aria-hidden={open ? undefined : true}
      >
        <div className="rail-folder-projects-clip">
          <div className={cn("flex flex-col gap-1 pt-1", !open && "pointer-events-none")}>
            {projects}
          </div>
        </div>
      </div>
    </div>
  );
}

// Slides out from the rail; Base UI then skips this once the next icon is hovered.
const RAIL_TOOLTIP_CLASS =
  "max-w-72 transition-[width,height,scale,opacity,translate] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-starting-style:-translate-x-1 data-ending-style:-translate-x-1";

const EMPTY_FOLDER_SETTINGS: SidebarProjectFolderSettings = { folders: [], assignments: {} };
const RAIL_DROP_HIGHLIGHT_CLASS = "bg-sidebar-row-hover ring-1 ring-ring/80";
const RAIL_FOLDER_BEFORE_CLASS = "shadow-[inset_0_2px_0_0_var(--color-ring)]";
const RAIL_FOLDER_AFTER_CLASS = "shadow-[inset_0_-2px_0_0_var(--color-ring)]";

function railDragTypes(event: DragEvent): readonly string[] {
  return event.dataTransfer === null ? [] : Array.from(event.dataTransfer.types);
}

function projectRailEnvironmentLine(project: SidebarProjectSnapshot): string | null {
  if (project.remoteEnvironmentLabels.length === 0) return null;
  const labels = project.remoteEnvironmentLabels.join(", ");
  return project.environmentPresence === "mixed" ? `Also on ${labels}` : `On ${labels}`;
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

function folderRailActivity(
  projects: readonly SidebarProjectSnapshot[],
  activityByProjectKey?: ReadonlyMap<string, ProjectRailActivity>,
): ProjectRailActivity | null {
  return mergeProjectRailActivity(
    projects.map((project) => activityByProjectKey?.get(project.projectKey)),
  );
}

function activityAccessibleLabel(label: string, activity: ProjectRailActivity | null): string {
  const detail = formatProjectRailActivity(activity, ", ");
  return detail === null ? label : `${label}, ${detail}`;
}

function ProjectRailActivityMark({ activity }: { activity: ProjectRailActivity | null }) {
  const mark = projectRailActivityMark(activity);
  if (mark === null) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute -bottom-0.5 -left-0.5 z-10 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 font-mono text-[9px] font-semibold tabular-nums ring-2 ring-sidebar",
        mark.tone === "working"
          ? "bg-sky-700 text-white dark:bg-sky-400 dark:text-sky-950"
          : "bg-sidebar-foreground text-sidebar",
      )}
    >
      {mark.count}
    </span>
  );
}

function ProjectRailActivityLine({ activity }: { activity: ProjectRailActivity | null }) {
  const label = formatProjectRailActivity(activity);
  if (label === null) return null;
  return (
    <span
      className={
        activity !== null && activity.working > 0
          ? "text-sky-700 dark:text-sky-300"
          : "text-muted-foreground"
      }
    >
      {label}
    </span>
  );
}

function ProjectRailTooltip({
  project,
  attention,
  activity,
}: {
  project: SidebarProjectSnapshot;
  attention: ProjectRailAttention | null;
  activity: ProjectRailActivity | null;
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
      <ProjectRailActivityLine activity={activity} />
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
  activity,
}: {
  name: string;
  projects: readonly SidebarProjectSnapshot[];
  collapsed: boolean;
  attention: ProjectRailAttention | null;
  activity: ProjectRailActivity | null;
}): ReactNode {
  return (
    <span className="flex min-w-0 w-full flex-col gap-0.5 py-0.5 text-left">
      <span className="min-w-0 w-full font-medium">{name}</span>
      <span className="text-muted-foreground">
        {projects.length} {projects.length === 1 ? "project" : "projects"}
        {collapsed ? " · collapsed" : ""}
      </span>
      <ProjectRailActivityLine activity={activity} />
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
  activity,
  selected,
  attention,
  onSelectProject,
  onNewThreadInProject,
  onProjectContextMenu,
  draggable = false,
  dragging = false,
  onDragStart,
  onDragEnd,
}: {
  project: SidebarProjectSnapshot;
  activity: ProjectRailActivity | null;
  selected: boolean;
  attention: ProjectRailAttention | null;
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
        "group/rail-item relative shrink-0",
        draggable && "cursor-grab",
        dragging && "opacity-50",
      )}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <SidebarMenuButton
        size="icon"
        aria-label={activityAccessibleLabel(`Show ${label} threads`, activity)}
        tooltip={{
          className: RAIL_TOOLTIP_CLASS,
          sideOffset: 8,
          children: (
            <ProjectRailTooltip project={project} attention={attention} activity={activity} />
          ),
        }}
        isActive={selected}
        aria-pressed={selected}
        onClick={() => onSelectProject(project)}
        onContextMenu={
          onProjectContextMenu ? (event) => onProjectContextMenu(event, project) : undefined
        }
      >
        <ProjectFavicon project={project} className="size-4 shrink-0" />
      </SidebarMenuButton>
      <ProjectRailActivityMark activity={activity} />
      {attention ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute -right-0.5 -top-0.5 z-10 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 font-mono text-[9px] font-semibold tabular-nums text-white ring-2 ring-sidebar",
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
          className="absolute -bottom-1 -right-1 z-10 flex size-4 cursor-pointer items-center justify-center rounded-full bg-sidebar-control-surface text-sidebar-foreground opacity-0 ring-1 ring-sidebar-border transition-opacity hover:bg-sidebar-row-hover focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-ring group-hover/rail-item:opacity-100"
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
 * entry shows every project. The same column sits beside the thread list and
 * is the whole sidebar when it is icon-only, so expanding never moves an icon.
 * `footer` pins utility controls under the projects. Search and new-thread
 * live on the peeked/expanded thread list, not here.
 */
export function SidebarProjectRail({
  projects,
  selectedProjectKey,
  onSelectProject,
  onSelectAll,
  attentionByProjectKey,
  activityByProjectKey,
  onNewThreadInProject,
  onProjectContextMenu,
  folders = EMPTY_FOLDER_SETTINGS,
  onToggleFolder,
  onFolderContextMenu,
  onApplyDrop,
  onReorderFolder,
  footer,
}: {
  projects: readonly SidebarProjectSnapshot[];
  selectedProjectKey: string | null;
  onSelectProject: (project: SidebarProjectSnapshot) => void;
  onSelectAll?: () => void;
  /** Strongest waiting-on-you / finished-PR status, plus a count, per project. */
  attentionByProjectKey?: ReadonlyMap<string, ProjectRailAttention>;
  /** Working and monitoring threads per project. Idle projects stay unmarked. */
  activityByProjectKey?: ReadonlyMap<string, ProjectRailActivity>;
  onNewThreadInProject?: (project: SidebarProjectSnapshot) => void;
  onProjectContextMenu?: (event: MouseEvent<HTMLElement>, project: SidebarProjectSnapshot) => void;
  folders?: SidebarProjectFolderSettings;
  onToggleFolder?: (folderId: string) => void;
  onFolderContextMenu?: (event: MouseEvent<HTMLElement>, folder: SidebarProjectFolder) => void;
  onApplyDrop?: (projectKey: string, target: ProjectRailDropTarget) => void;
  onReorderFolder?: (folderId: string, beforeFolderId: string | null) => void;
  footer?: ReactNode;
}) {
  const items = buildProjectRailItems(projects, folders);
  const [draggingProjectKey, setDraggingProjectKey] = useState<string | null>(null);
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [dropHighlight, setDropHighlight] = useState<string | null>(null);
  const canDrag = onApplyDrop !== undefined && folders.folders.length > 0;
  const canDragFolder = onReorderFolder !== undefined && folders.folders.length > 1;

  const acceptRailDrag = (event: DragEvent) => {
    if (draggingFolderId !== null || dataTransferHasRailFolder(railDragTypes(event))) {
      return false;
    }
    if (draggingProjectKey === null && !dataTransferHasRailProject(railDragTypes(event))) {
      return false;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    return true;
  };

  const acceptFolderDrag = (event: DragEvent) => {
    if (draggingFolderId === null && !dataTransferHasRailFolder(railDragTypes(event))) {
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

  const finishFolderDrop = (
    event: DragEvent,
    target:
      | { readonly kind: "end" }
      | { readonly kind: "insert"; readonly folderId: string; readonly place: "before" | "after" },
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const folderId = draggingFolderId ?? event.dataTransfer?.getData(RAIL_FOLDER_DRAG_TYPE);
    if (folderId !== undefined && folderId.length > 0) {
      const beforeFolderId =
        target.kind === "end"
          ? null
          : folderDropBeforeId(folders.folders, target.folderId, target.place);
      onReorderFolder?.(folderId, beforeFolderId);
    }
    setDraggingFolderId(null);
    setDropHighlight(null);
  };

  const highlightUngrouped = (highlight: "all" | "list") => (event: DragEvent<HTMLElement>) => {
    if (acceptFolderDrag(event)) {
      setDropHighlight(highlight === "list" ? "folder-end" : null);
      return;
    }
    if (!acceptRailDrag(event)) return;
    setDropHighlight(highlight);
  };
  const dropUngrouped = (surface: "all" | "list") => (event: DragEvent<HTMLElement>) => {
    if (draggingFolderId !== null || dataTransferHasRailFolder(railDragTypes(event))) {
      if (surface === "list") finishFolderDrop(event, { kind: "end" });
      else event.preventDefault();
      return;
    }
    finishDrop(event, { kind: "ungrouped" });
  };

  const renderProject = (project: SidebarProjectSnapshot) => (
    <ProjectRailItem
      key={project.projectKey}
      project={project}
      activity={activityByProjectKey?.get(project.projectKey) ?? null}
      selected={selectedProjectKey === project.projectKey}
      attention={attentionByProjectKey?.get(project.projectKey) ?? null}
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
    const activity = folderRailActivity(item.projects, activityByProjectKey);
    const containsSelected = item.projects.some(
      (project) => project.projectKey === selectedProjectKey,
    );
    const drop: RailFolderDrop =
      dropHighlight === `folder:${item.folder.id}`
        ? "in"
        : dropHighlight === `folder-before:${item.folder.id}`
          ? "before"
          : dropHighlight === `folder-after:${item.folder.id}`
            ? "after"
            : null;
    return (
      <RailFolderFrame
        key={item.folder.id}
        open={!item.folder.collapsed}
        drop={drop}
        dragging={draggingFolderId === item.folder.id}
        onDragOver={(event) => {
          if (acceptFolderDrag(event)) {
            event.stopPropagation();
            if (draggingFolderId === item.folder.id) {
              setDropHighlight(null);
              return;
            }
            const rect = event.currentTarget.getBoundingClientRect();
            const place = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
            setDropHighlight(`folder-${place}:${item.folder.id}`);
            return;
          }
          if (!acceptRailDrag(event)) return;
          event.stopPropagation();
          setDropHighlight(`folder:${item.folder.id}`);
        }}
        onDrop={(event) => {
          if (draggingFolderId !== null || dataTransferHasRailFolder(railDragTypes(event))) {
            const rect = event.currentTarget.getBoundingClientRect();
            const place = event.clientY > rect.top + rect.height / 2 ? "after" : "before";
            finishFolderDrop(event, { kind: "insert", folderId: item.folder.id, place });
            return;
          }
          finishDrop(event, { kind: "folder", folderId: item.folder.id });
        }}
        button={
          <div
            className={cn("relative w-full shrink-0", canDragFolder && "cursor-grab")}
            draggable={canDragFolder}
            onDragStart={(event) => {
              event.dataTransfer.setData(RAIL_FOLDER_DRAG_TYPE, item.folder.id);
              event.dataTransfer.setData("text/plain", item.folder.id);
              event.dataTransfer.effectAllowed = "move";
              setDraggingFolderId(item.folder.id);
              event.stopPropagation();
            }}
            onDragEnd={() => {
              setDraggingFolderId(null);
              setDropHighlight(null);
            }}
          >
            <SidebarMenuButton
              size="icon"
              aria-label={activityAccessibleLabel(
                `${item.folder.collapsed ? "Expand" : "Collapse"} ${item.folder.name}`,
                item.folder.collapsed ? activity : null,
              )}
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
                    activity={activity}
                  />
                ),
              }}
              isActive={containsSelected && item.folder.collapsed}
              onClick={() => onToggleFolder?.(item.folder.id)}
              onContextMenu={
                onFolderContextMenu ? (event) => onFolderContextMenu(event, item.folder) : undefined
              }
            >
              <FolderRailGlyph folder={item.folder} />
            </SidebarMenuButton>
            {item.folder.collapsed ? <ProjectRailActivityMark activity={activity} /> : null}
            {item.folder.collapsed && attention ? (
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute -right-0.5 -top-0.5 z-10 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 font-mono text-[9px] font-semibold tabular-nums text-white ring-2 ring-sidebar",
                  attention.dotClass,
                )}
              >
                {attention.count}
              </span>
            ) : null}
          </div>
        }
        projects={item.projects.map((project) => (
          <div key={project.projectKey} className="rail-folder-project w-full">
            {renderProject(project)}
          </div>
        ))}
      />
    );
  });

  return (
    <TooltipProvider delay={150} closeDelay={0} timeout={400}>
      <nav
        aria-label="Projects"
        className="flex min-h-0 w-12 shrink-0 flex-col items-center gap-1 py-2"
        onDragLeave={(event) => {
          const next = event.relatedTarget;
          if (next instanceof Node && event.currentTarget.contains(next)) return;
          setDropHighlight(null);
        }}
      >
        {onSelectAll ? (
          <SidebarMenuButton
            size="icon"
            aria-label="All projects"
            tooltip={{ className: RAIL_TOOLTIP_CLASS, children: "All projects" }}
            isActive={selectedProjectKey === null}
            aria-pressed={selectedProjectKey === null}
            className={cn(dropHighlight === "all" && RAIL_DROP_HIGHLIGHT_CLASS)}
            onClick={onSelectAll}
            onDragOver={highlightUngrouped("all")}
            onDrop={dropUngrouped("all")}
          >
            <LayersIcon />
          </SidebarMenuButton>
        ) : null}
        <div
          className={cn(
            "flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden py-0.5",
            dropHighlight === "list" && "rounded-lg",
            dropHighlight === "list" && RAIL_DROP_HIGHLIGHT_CLASS,
            dropHighlight === "folder-end" && RAIL_FOLDER_AFTER_CLASS,
          )}
          onDragOver={highlightUngrouped("list")}
          onDrop={dropUngrouped("list")}
        >
          {railItems}
          <SidebarMenuButton
            size="icon"
            aria-label="Add project"
            tooltip={{ className: RAIL_TOOLTIP_CLASS, children: "Add project" }}
            onClick={openAddProject}
          >
            <FolderPlusIcon />
          </SidebarMenuButton>
        </div>
        {footer ? (
          <div className="flex shrink-0 flex-col items-center gap-0.5 pt-1">{footer}</div>
        ) : null}
      </nav>
    </TooltipProvider>
  );
}
