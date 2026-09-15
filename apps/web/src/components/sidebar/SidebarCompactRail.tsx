import { FolderPlusIcon, SearchIcon, SquarePenIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { ProjectFavicon } from "../ProjectFavicon";
import { SidebarMenuButton } from "../ui/sidebar";

const openNewThreadPicker = () => openCommandPalette({ open: "new-thread-in" });

/** Compact navigation uses the same project grouping and actions as the full sidebar. */
export function SidebarCompactRail({
  projects,
  selectedProjectKey,
  onSelectProject,
  onNewThread = openNewThreadPicker,
}: {
  projects: readonly SidebarProjectSnapshot[];
  selectedProjectKey: string | null;
  onSelectProject: (project: SidebarProjectSnapshot) => void;
  onNewThread?: (event: MouseEvent) => void;
}) {
  return (
    <nav
      aria-label="Compact sidebar"
      className="flex min-h-0 flex-1 flex-col items-center gap-2 py-2"
    >
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
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden py-2">
        {projects.map((project) => {
          const label = [project.displayName, ...project.remoteEnvironmentLabels].join(" · ");
          return (
            <SidebarMenuButton
              key={project.projectKey}
              size="icon"
              className="shrink-0"
              aria-label={`Show ${label} threads`}
              tooltip={label}
              isActive={selectedProjectKey === project.projectKey}
              aria-pressed={selectedProjectKey === project.projectKey}
              onClick={() => onSelectProject(project)}
            >
              <ProjectFavicon project={project} className="size-4 shrink-0" />
            </SidebarMenuButton>
          );
        })}
      </div>
      <SidebarMenuButton
        size="icon"
        aria-label="Add project"
        tooltip="Add project"
        onClick={() => openCommandPalette({ open: "add-project" })}
      >
        <FolderPlusIcon />
      </SidebarMenuButton>
    </nav>
  );
}
