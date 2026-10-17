import type { ServerSettingsPatch, SidebarProjectLayout } from "@t3tools/contracts/settings";

/** Code-unit ordering is independent of the machine's locale and record insertion order. */
function contentKey(layout: Omit<SidebarProjectLayout, "version">): string {
  return JSON.stringify([
    layout.folders.map(({ id, name, collapsed, icon }) => [
      id,
      name,
      collapsed,
      icon
        ? Object.keys(icon)
            .sort()
            .map((key) => [key, Reflect.get(icon, key)])
        : null,
    ]),
    Object.keys(layout.assignments)
      .sort()
      .map((key) => [key, layout.assignments[key]]),
    layout.projectOrder,
    layout.sortOrder ?? null,
    layout.groupingMode ?? null,
    Object.keys(layout.groupingOverrides ?? {})
      .sort()
      .map((key) => [key, layout.groupingOverrides?.[key]]),
  ]);
}

/** Concurrent revisions converge to the same whole layout on every machine. */
export function compareSidebarProjectLayouts(
  left: SidebarProjectLayout,
  right: SidebarProjectLayout,
): number {
  if (left.version !== right.version) return left.version - right.version;
  const a = contentKey(left);
  const b = contentKey(right);
  return a === b ? 0 : a < b ? -1 : 1;
}

export function resolveSidebarProjectLayout(
  layouts: ReadonlyArray<SidebarProjectLayout | null | undefined>,
): SidebarProjectLayout | null {
  let latest: SidebarProjectLayout | null = null;
  for (const layout of layouts) {
    if (layout && (latest === null || compareSidebarProjectLayouts(layout, latest) > 0)) {
      latest = layout;
    }
  }
  return latest;
}

export function nextSidebarProjectLayout(
  current: SidebarProjectLayout | null,
  content: Omit<SidebarProjectLayout, "version">,
  now: number,
): SidebarProjectLayout {
  return { ...content, version: Math.max(now, (current?.version ?? 0) + 1) };
}

/** Resolve known path aliases without dropping entries for projects that are offline. */
export function canonicalizeSidebarProjectLayout(
  layout: SidebarProjectLayout,
  aliases: ReadonlyMap<string, string>,
): SidebarProjectLayout {
  const projectOrder = [...new Set(layout.projectOrder.map((key) => aliases.get(key) ?? key))];
  const assignments = new Map<string, string>();
  for (const key of Object.keys(layout.assignments).sort()) {
    const canonical = aliases.get(key) ?? key;
    if (!assignments.has(canonical) || key === canonical) {
      assignments.set(canonical, layout.assignments[key]!);
    }
  }
  if (
    projectOrder.length === layout.projectOrder.length &&
    projectOrder.every((key, index) => key === layout.projectOrder[index]) &&
    assignments.size === Object.keys(layout.assignments).length &&
    [...assignments].every(([key, value]) => layout.assignments[key] === value)
  )
    return layout;
  return { ...layout, projectOrder, assignments: Object.fromEntries(assignments) };
}

/** Keep a hidden/offline project's place when the visible subset is reordered. */
export function mergeSidebarProjectOrder(
  saved: readonly string[],
  visible: readonly string[],
): string[] {
  const remaining = [...new Set(visible)];
  const visibleKeys = new Set(remaining);
  let index = 0;
  const merged = [...new Set(saved)].map((key) =>
    visibleKeys.has(key) ? remaining[index++]! : key,
  );
  return [...merged, ...remaining.slice(index)];
}

/** Older clients can still edit folders; delayed versioned writes cannot undo newer edits. */
export function reconcileSidebarProjectLayoutPatch(
  current: { readonly sidebarProjectLayout: SidebarProjectLayout | null },
  patch: ServerSettingsPatch,
): ServerSettingsPatch {
  const { sidebarProjectLayout, sidebarProjectFolders, sidebarProjectFolderAssignments, ...rest } =
    patch;
  if (sidebarProjectLayout === null) return rest;
  if (sidebarProjectLayout !== undefined) {
    if (
      current.sidebarProjectLayout &&
      compareSidebarProjectLayouts(sidebarProjectLayout, current.sidebarProjectLayout) < 0
    )
      return rest;
    return {
      ...rest,
      sidebarProjectLayout,
      sidebarProjectFolders: sidebarProjectLayout.folders,
      sidebarProjectFolderAssignments: sidebarProjectLayout.assignments,
    };
  }
  if (
    current.sidebarProjectLayout &&
    (sidebarProjectFolders !== undefined || sidebarProjectFolderAssignments !== undefined)
  ) {
    const layout = nextSidebarProjectLayout(
      current.sidebarProjectLayout,
      {
        ...current.sidebarProjectLayout,
        folders: sidebarProjectFolders ?? current.sidebarProjectLayout.folders,
        assignments: sidebarProjectFolderAssignments ?? current.sidebarProjectLayout.assignments,
        projectOrder: current.sidebarProjectLayout.projectOrder,
      },
      current.sidebarProjectLayout.version + 1,
    );
    return {
      ...rest,
      sidebarProjectLayout: layout,
      sidebarProjectFolders: layout.folders,
      sidebarProjectFolderAssignments: layout.assignments,
    };
  }
  return patch;
}
