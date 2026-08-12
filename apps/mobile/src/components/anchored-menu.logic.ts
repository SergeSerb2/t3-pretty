import type { MenuAction } from "@react-native-menu/menu";

export type MenuRow =
  | { readonly type: "header"; readonly title: string }
  | { readonly type: "action"; readonly action: MenuAction };

/**
 * Turns a MenuAction list into render rows. Hidden items are dropped.
 * `displayInline` submenus flatten into a section header plus their children
 * (matching UIMenu's inline groups) instead of becoming a drill-in page.
 */
export function flattenMenuActions(actions: readonly MenuAction[]): MenuRow[] {
  const rows: MenuRow[] = [];
  for (const action of actions) {
    if (action.attributes?.hidden === true) {
      continue;
    }
    if (action.displayInline === true && (action.subactions?.length ?? 0) > 0) {
      if (action.title.length > 0) {
        rows.push({ type: "header", title: action.title });
      }
      rows.push(...flattenMenuActions(action.subactions ?? []));
      continue;
    }
    rows.push({ type: "action", action });
  }
  return rows;
}

export function homeListFilterItemsToActions(
  items: ReadonlyArray<{
    readonly type: "action" | "submenu";
    readonly title: string;
    readonly subtitle?: string;
    readonly state?: "on" | "off";
    readonly onPress?: () => void;
    readonly items?: ReadonlyArray<{
      readonly type: "action";
      readonly title: string;
      readonly subtitle?: string;
      readonly state?: "on" | "off";
      readonly onPress: () => void;
    }>;
  }>,
  path = "",
): {
  readonly actions: MenuAction[];
  readonly handlers: Map<string, () => void>;
} {
  const handlers = new Map<string, () => void>();
  const actions: MenuAction[] = items.map((item, index) => {
    const id = path.length > 0 ? `${path}:${index}` : `${index}`;
    if (item.type === "submenu") {
      const nested = homeListFilterItemsToActions(item.items ?? [], id);
      for (const [key, handler] of nested.handlers) {
        handlers.set(key, handler);
      }
      return {
        id,
        title: item.title,
        subactions: nested.actions,
      };
    }
    if (item.onPress) {
      handlers.set(id, item.onPress);
    }
    return {
      id,
      title: item.title,
      subtitle: item.subtitle,
      state: item.state === "on" ? ("on" as const) : undefined,
    };
  });
  return { actions, handlers };
}
