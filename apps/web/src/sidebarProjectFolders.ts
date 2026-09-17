import type { ContextMenuItem } from "@t3tools/contracts";
import type { SidebarProjectFolder } from "@t3tools/contracts/settings";

export interface SidebarProjectFolderSettings {
  readonly folders: readonly SidebarProjectFolder[];
  readonly assignments: Readonly<Record<string, string>>;
}

export type ProjectRailItem<T extends { projectKey: string }> =
  | {
      readonly kind: "folder";
      readonly folder: SidebarProjectFolder;
      readonly projects: readonly T[];
    }
  | { readonly kind: "project"; readonly project: T };

const MENU_PREFIX = "project-folder:";

export function selectProjectFolderSettings(settings: {
  readonly sidebarProjectFolders: readonly SidebarProjectFolder[];
  readonly sidebarProjectFolderAssignments: Readonly<Record<string, string>>;
}): SidebarProjectFolderSettings {
  return {
    folders: settings.sidebarProjectFolders,
    assignments: settings.sidebarProjectFolderAssignments,
  };
}

export function buildProjectRailItems<T extends { projectKey: string }>(
  projects: readonly T[],
  settings: SidebarProjectFolderSettings,
): ProjectRailItem<T>[] {
  const foldersById = new Map(settings.folders.map((folder) => [folder.id, folder]));
  const membersByFolder = new Map<string, T[]>();
  const ungrouped: T[] = [];
  for (const project of projects) {
    const folderId = settings.assignments[project.projectKey];
    if (folderId !== undefined && foldersById.has(folderId)) {
      const members = membersByFolder.get(folderId);
      if (members) members.push(project);
      else membersByFolder.set(folderId, [project]);
      continue;
    }
    ungrouped.push(project);
  }

  const items: ProjectRailItem<T>[] = [];
  for (const folder of settings.folders) {
    const members = membersByFolder.get(folder.id);
    if (members === undefined || members.length === 0) continue;
    items.push({ kind: "folder", folder, projects: members });
  }
  for (const project of ungrouped) {
    items.push({ kind: "project", project });
  }
  return items;
}

function normalizeFolderName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function pruneEmptyFolders(
  settings: SidebarProjectFolderSettings,
  knownProjectKeys?: ReadonlySet<string>,
): SidebarProjectFolderSettings {
  const assignedIds = new Set<string>();
  for (const [projectKey, folderId] of Object.entries(settings.assignments)) {
    if (knownProjectKeys !== undefined && !knownProjectKeys.has(projectKey)) continue;
    assignedIds.add(folderId);
  }
  const folders = settings.folders.filter((folder) => assignedIds.has(folder.id));
  const liveFolderIds = new Set(folders.map((folder) => folder.id));
  const assignments = Object.fromEntries(
    Object.entries(settings.assignments).filter(([, folderId]) => liveFolderIds.has(folderId)),
  );
  return { folders, assignments };
}

export function createProjectFolder(
  settings: SidebarProjectFolderSettings,
  name: string,
  projectKey: string,
  id: string,
): SidebarProjectFolderSettings {
  const normalized = normalizeFolderName(name);
  if (normalized === null) return settings;
  return pruneEmptyFolders({
    folders: [...settings.folders, { id, name: normalized, collapsed: false }],
    assignments: { ...settings.assignments, [projectKey]: id },
  });
}

export function assignProjectToFolder(
  settings: SidebarProjectFolderSettings,
  projectKey: string,
  folderId: string,
): SidebarProjectFolderSettings {
  if (!settings.folders.some((folder) => folder.id === folderId)) return settings;
  return pruneEmptyFolders({
    folders: settings.folders,
    assignments: { ...settings.assignments, [projectKey]: folderId },
  });
}

export function unassignProjectFromFolder(
  settings: SidebarProjectFolderSettings,
  projectKey: string,
): SidebarProjectFolderSettings {
  if (settings.assignments[projectKey] === undefined) return settings;
  const { [projectKey]: _removed, ...assignments } = settings.assignments;
  return pruneEmptyFolders({ folders: settings.folders, assignments });
}

export const RAIL_PROJECT_DRAG_TYPE = "application/x-t3-rail-project";

export type ProjectRailDropTarget =
  | { readonly kind: "folder"; readonly folderId: string }
  | { readonly kind: "ungrouped" };

export function dataTransferHasRailProject(types: readonly string[]): boolean {
  return types.includes(RAIL_PROJECT_DRAG_TYPE);
}

export function applyProjectRailDrop(
  settings: SidebarProjectFolderSettings,
  projectKey: string,
  target: ProjectRailDropTarget,
): SidebarProjectFolderSettings {
  if (target.kind === "ungrouped") return unassignProjectFromFolder(settings, projectKey);
  if (settings.assignments[projectKey] === target.folderId) return settings;
  return assignProjectToFolder(settings, projectKey, target.folderId);
}

export function renameProjectFolder(
  settings: SidebarProjectFolderSettings,
  folderId: string,
  name: string,
): SidebarProjectFolderSettings {
  const normalized = normalizeFolderName(name);
  if (normalized === null) return settings;
  return {
    ...settings,
    folders: settings.folders.map((folder) =>
      folder.id === folderId ? { ...folder, name: normalized } : folder,
    ),
  };
}

export function toggleProjectFolderCollapsed(
  settings: SidebarProjectFolderSettings,
  folderId: string,
): SidebarProjectFolderSettings {
  return {
    ...settings,
    folders: settings.folders.map((folder) =>
      folder.id === folderId ? { ...folder, collapsed: !folder.collapsed } : folder,
    ),
  };
}

export function deleteProjectFolder(
  settings: SidebarProjectFolderSettings,
  folderId: string,
): SidebarProjectFolderSettings {
  return {
    folders: settings.folders.filter((folder) => folder.id !== folderId),
    assignments: Object.fromEntries(
      Object.entries(settings.assignments).filter(([, assignedId]) => assignedId !== folderId),
    ),
  };
}

export function moveProjectFolder(
  settings: SidebarProjectFolderSettings,
  folderId: string,
  direction: -1 | 1,
): SidebarProjectFolderSettings {
  const index = settings.folders.findIndex((folder) => folder.id === folderId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= settings.folders.length) return settings;
  const folders = settings.folders.slice();
  const [folder] = folders.splice(index, 1);
  folders.splice(nextIndex, 0, folder!);
  return { ...settings, folders };
}

export function projectFolderMenuItems(input: {
  readonly projectKey: string;
  readonly settings: SidebarProjectFolderSettings;
}): ContextMenuItem[] {
  const assignedFolderId = input.settings.assignments[input.projectKey];
  const moveChildren: ContextMenuItem[] = input.settings.folders.map((folder) => ({
    id: `${MENU_PREFIX}move:${folder.id}`,
    label: folder.name,
    disabled: folder.id === assignedFolderId,
  }));
  moveChildren.push({
    id: `${MENU_PREFIX}new`,
    label: "New folder…",
    separatorBefore: moveChildren.length > 0,
  });
  const items: ContextMenuItem[] = [
    {
      id: `${MENU_PREFIX}move-menu`,
      label: "Move to folder",
      icon: "folder",
      children: moveChildren,
    },
  ];
  if (assignedFolderId !== undefined) {
    items.push({ id: `${MENU_PREFIX}remove`, label: "Remove from folder" });
  }
  return items;
}

export function projectFolderHeaderMenuItems(input: {
  readonly folder: SidebarProjectFolder;
  readonly settings: SidebarProjectFolderSettings;
}): ContextMenuItem[] {
  const index = input.settings.folders.findIndex((folder) => folder.id === input.folder.id);
  return [
    {
      id: `${MENU_PREFIX}toggle:${input.folder.id}`,
      label: input.folder.collapsed ? "Expand" : "Collapse",
    },
    { id: `${MENU_PREFIX}rename:${input.folder.id}`, label: "Rename…" },
    {
      id: `${MENU_PREFIX}move-up:${input.folder.id}`,
      label: "Move up",
      disabled: index <= 0,
    },
    {
      id: `${MENU_PREFIX}move-down:${input.folder.id}`,
      label: "Move down",
      disabled: index < 0 || index >= input.settings.folders.length - 1,
    },
    {
      id: `${MENU_PREFIX}delete:${input.folder.id}`,
      label: "Delete folder",
      icon: "trash",
      destructive: true,
      separatorBefore: true,
    },
  ];
}

export type ProjectFolderMenuAction =
  | { readonly type: "new" }
  | { readonly type: "remove" }
  | { readonly type: "move"; readonly folderId: string }
  | { readonly type: "toggle"; readonly folderId: string }
  | { readonly type: "rename"; readonly folderId: string }
  | { readonly type: "delete"; readonly folderId: string }
  | { readonly type: "move-up"; readonly folderId: string }
  | { readonly type: "move-down"; readonly folderId: string };

export function parseProjectFolderMenuAction(id: string): ProjectFolderMenuAction | null {
  if (!id.startsWith(MENU_PREFIX)) return null;
  const rest = id.slice(MENU_PREFIX.length);
  if (rest === "new") return { type: "new" };
  if (rest === "remove") return { type: "remove" };
  const separator = rest.indexOf(":");
  if (separator < 0) return null;
  const type = rest.slice(0, separator);
  const folderId = rest.slice(separator + 1);
  if (folderId.length === 0) return null;
  if (
    type === "move" ||
    type === "toggle" ||
    type === "rename" ||
    type === "delete" ||
    type === "move-up" ||
    type === "move-down"
  ) {
    return { type, folderId };
  }
  return null;
}
