import { describe, expect, it } from "vite-plus/test";

import {
  applyProjectRailDrop,
  assignProjectToFolder,
  buildProjectRailItems,
  createProjectFolder,
  dataTransferHasRailProject,
  deleteProjectFolder,
  moveProjectFolder,
  parseProjectFolderMenuAction,
  projectFolderHeaderMenuItems,
  projectFolderMenuItems,
  RAIL_PROJECT_DRAG_TYPE,
  renameProjectFolder,
  toggleProjectFolderCollapsed,
  unassignProjectFromFolder,
  type SidebarProjectFolderSettings,
} from "./sidebarProjectFolders";

const empty: SidebarProjectFolderSettings = { folders: [], assignments: {} };

function project(projectKey: string) {
  return { projectKey };
}

describe("buildProjectRailItems", () => {
  it("keeps the project order when nothing is grouped", () => {
    expect(buildProjectRailItems([project("a"), project("b")], empty)).toEqual([
      { kind: "project", project: { projectKey: "a" } },
      { kind: "project", project: { projectKey: "b" } },
    ]);
  });

  it("emits folders in folder order, then ungrouped projects", () => {
    const settings: SidebarProjectFolderSettings = {
      folders: [
        { id: "work", name: "Work", collapsed: false },
        { id: "home", name: "Personal", collapsed: true },
      ],
      assignments: { w1: "work", w2: "work", h1: "home" },
    };
    expect(
      buildProjectRailItems(
        [project("h1"), project("loose"), project("w2"), project("w1")],
        settings,
      ),
    ).toEqual([
      {
        kind: "folder",
        folder: settings.folders[0],
        projects: [project("w2"), project("w1")],
      },
      {
        kind: "folder",
        folder: settings.folders[1],
        projects: [project("h1")],
      },
      { kind: "project", project: { projectKey: "loose" } },
    ]);
  });

  it("treats unknown folder ids as ungrouped and hides empty folders", () => {
    const settings: SidebarProjectFolderSettings = {
      folders: [
        { id: "gone", name: "Gone", collapsed: false },
        { id: "work", name: "Work", collapsed: false },
      ],
      assignments: { a: "missing", b: "work" },
    };
    expect(buildProjectRailItems([project("a"), project("b")], settings)).toEqual([
      {
        kind: "folder",
        folder: settings.folders[1],
        projects: [project("b")],
      },
      { kind: "project", project: { projectKey: "a" } },
    ]);
  });
});

describe("project folder mutations", () => {
  it("creates a folder, moves a project, and prunes when the last member leaves", () => {
    const created = createProjectFolder(empty, " Work ", "alpha", "work");
    expect(created).toEqual({
      folders: [{ id: "work", name: "Work", collapsed: false }],
      assignments: { alpha: "work" },
    });
    const two = createProjectFolder(created, "Home", "beta", "home");
    const moved = assignProjectToFolder(two, "alpha", "home");
    expect(moved.folders.map((folder) => folder.id)).toEqual(["home"]);
    expect(moved.assignments).toEqual({ alpha: "home", beta: "home" });
    expect(unassignProjectFromFolder(moved, "alpha").assignments).toEqual({ beta: "home" });
  });

  it("ignores blank names and unknown folder moves", () => {
    expect(createProjectFolder(empty, "   ", "alpha", "work")).toEqual(empty);
    expect(assignProjectToFolder(empty, "alpha", "missing")).toEqual(empty);
  });

  it("files a dragged project into a folder or back onto the ungrouped list", () => {
    const settings = createProjectFolder(empty, "Work", "a", "work");
    expect(
      applyProjectRailDrop(settings, "b", { kind: "folder", folderId: "work" }).assignments,
    ).toEqual({ a: "work", b: "work" });
    expect(applyProjectRailDrop(settings, "a", { kind: "ungrouped" }).assignments).toEqual({});
    expect(applyProjectRailDrop(settings, "a", { kind: "folder", folderId: "work" })).toBe(
      settings,
    );
    expect(applyProjectRailDrop(settings, "a", { kind: "folder", folderId: "missing" })).toBe(
      settings,
    );
    expect(dataTransferHasRailProject([RAIL_PROJECT_DRAG_TYPE, "text/plain"])).toBe(true);
    expect(dataTransferHasRailProject(["text/plain"])).toBe(false);
  });

  it("renames, toggles collapse, reorders, and deletes", () => {
    const settings = createProjectFolder(
      createProjectFolder(empty, "Work", "a", "work"),
      "Home",
      "b",
      "home",
    );
    expect(renameProjectFolder(settings, "work", " Job ").folders[0]?.name).toBe("Job");
    expect(toggleProjectFolderCollapsed(settings, "work").folders[0]?.collapsed).toBe(true);
    expect(moveProjectFolder(settings, "home", -1).folders.map((folder) => folder.id)).toEqual([
      "home",
      "work",
    ]);
    expect(moveProjectFolder(settings, "work", -1)).toEqual(settings);
    expect(deleteProjectFolder(settings, "work")).toEqual({
      folders: [{ id: "home", name: "Home", collapsed: false }],
      assignments: { b: "home" },
    });
  });
});

describe("project folder menus", () => {
  it("lists folders for a move and marks the current assignment", () => {
    const settings = createProjectFolder(empty, "Work", "a", "work");
    expect(projectFolderMenuItems({ projectKey: "a", settings })).toEqual([
      {
        id: "project-folder:move-menu",
        label: "Move to folder",
        icon: "folder",
        children: [
          { id: "project-folder:move:work", label: "Work", disabled: true },
          { id: "project-folder:new", label: "New folder…", separatorBefore: true },
        ],
      },
      { id: "project-folder:remove", label: "Remove from folder" },
    ]);
    expect(projectFolderHeaderMenuItems({ folder: settings.folders[0]!, settings })).toEqual([
      { id: "project-folder:toggle:work", label: "Collapse" },
      { id: "project-folder:rename:work", label: "Rename…" },
      { id: "project-folder:move-up:work", label: "Move up", disabled: true },
      { id: "project-folder:move-down:work", label: "Move down", disabled: true },
      {
        id: "project-folder:delete:work",
        label: "Delete folder",
        icon: "trash",
        destructive: true,
        separatorBefore: true,
      },
    ]);
  });

  it("parses folder menu ids and ignores unrelated actions", () => {
    expect(parseProjectFolderMenuAction("project-folder:new")).toEqual({ type: "new" });
    expect(parseProjectFolderMenuAction("project-folder:move:work")).toEqual({
      type: "move",
      folderId: "work",
    });
    expect(parseProjectFolderMenuAction("remove")).toBeNull();
    expect(parseProjectFolderMenuAction("project-folder:move:")).toBeNull();
  });
});
