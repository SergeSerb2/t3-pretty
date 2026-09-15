import { FolderPlusIcon, LayersIcon, PlusIcon, SearchIcon, SquarePenIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { cn } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";
import type { ThreadStatusPill } from "../Sidebar.logic";
import { SidebarMenuButton } from "../ui/sidebar";

const openNewThreadPicker = () => openCommandPalette({ open: "new-thread-in" });
const openAddProject = () => openCommandPalette({ open: "add-project" });

/**
 * Vertical strip of project icons. The rail is the only project axis in the
 * sidebar: picking an icon scopes the thread list to that project, the top
 * entry shows every project. `docked` renders beside the list; `collapsed`
 * stands in for the whole sidebar and carries search and new-thread too.
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
  /** Strongest status that still needs the user, per logical project key. */
  attentionByProjectKey?: ReadonlyMap<string, ThreadStatusPill>;
  onNewThreadInProject?: (project: SidebarProjectSnapshot) => void;
  onProjectContextMenu?: (event: MouseEvent<HTMLElement>, project: SidebarProjectSnapshot) => void;
  onNewThread?: (event: MouseEvent) => void;
}) {
  const docked = variant === "docked";
  return (
    <nav
      aria-label="Projects"
      className={cn(
        "flex min-h-0 flex-col items-center gap-1.5 py-2",
        docked ? "w-12 shrink-0 border-r border-sidebar-border/60" : "flex-1",
      )}
    >
      {docked ? (
        <SidebarMenuButton
          size="icon"
          aria-label="All projects"
          tooltip="All projects"
          isActive={selectedProjectKey === null}
          aria-pressed={selectedProjectKey === null}
          onClick={onSelectAll}
        >
          <LayersIcon />
        </SidebarMenuButton>
      ) : (
        <>
          <SidebarMenuButton
            size="icon"
            aria-label="Search threads"
            tooltip="Search threads"
            onClick={() => openCommandPalette()}
          >
            <SearchIcon />
          </SidebarMenuButton>
          <SidebarMenuButton
            size="icon"
            aria-label="New thread"
            tooltip="New thread"
            disabled={projects.length === 0}
            onClick={onNewThread}
          >
            <SquarePenIcon />
          </SidebarMenuButton>
        </>
      )}
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden py-1">
        {projects.map((project) => {
          const label = [project.displayName, ...project.remoteEnvironmentLabels].join(" · ");
          const attention = attentionByProjectKey?.get(project.projectKey) ?? null;
          const selected = selectedProjectKey === project.projectKey;
          return (
            <div key={project.projectKey} className="group/rail-item relative shrink-0">
              <SidebarMenuButton
                size="icon"
                aria-label={`Show ${label} threads`}
                tooltip={attention ? `${label} · ${attention.label}` : label}
                isActive={selected}
                aria-pressed={selected}
                onClick={() => onSelectProject(project)}
                onContextMenu={
                  onProjectContextMenu ? (event) => onProjectContextMenu(event, project) : undefined
                }
              >
                <ProjectFavicon project={project} className="size-4 shrink-0" />
              </SidebarMenuButton>
              {attention ? (
                <span
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-sidebar",
                    attention.dotClass,
                  )}
                />
              ) : null}
              {onNewThreadInProject ? (
                <button
                  type="button"
                  aria-label={`New thread in ${project.displayName}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onNewThreadInProject(project);
                  }}
                  className="absolute -bottom-1 -right-1 flex size-4 cursor-pointer items-center justify-center rounded-full bg-sidebar-control-surface text-sidebar-foreground opacity-0 ring-1 ring-sidebar-border transition-opacity hover:bg-sidebar-row-hover focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-ring group-hover/rail-item:opacity-100"
                >
                  <PlusIcon className="size-2.5" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <SidebarMenuButton
        size="icon"
        aria-label="Add project"
        tooltip="Add project"
        onClick={openAddProject}
      >
        <FolderPlusIcon />
      </SidebarMenuButton>
    </nav>
  );
}
