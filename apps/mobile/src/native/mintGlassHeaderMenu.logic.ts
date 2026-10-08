import type { MenuAction } from "@react-native-menu/menu";
import type { NativeStackHeaderItemMenu } from "@react-navigation/native-stack";

type HeaderMenuEntry = NativeStackHeaderItemMenu["menu"]["items"][number];

/**
 * Converts a native-stack header menu into `@react-native-menu/menu` actions.
 * Action ids are tree paths; `handlers` maps each id back to its onPress.
 */
export function headerMenuActions(entries: ReadonlyArray<HeaderMenuEntry>, prefix = "") {
  const handlers = new Map<string, () => void>();
  const actions = entries.map((entry, index): MenuAction => {
    const id = `${prefix}${index}`;
    const image = entry.icon?.type === "sfSymbol" ? entry.icon.name : undefined;
    if (entry.type === "submenu") {
      const nested = headerMenuActions(entry.items, `${id}.`);
      for (const [key, handler] of nested.handlers) handlers.set(key, handler);
      return {
        id,
        title: entry.label,
        image,
        displayInline: entry.inline,
        subactions: nested.actions,
      };
    }
    handlers.set(id, entry.onPress);
    return {
      id,
      title: entry.label,
      subtitle: entry.description,
      image,
      state: entry.state,
      attributes: {
        destructive: entry.destructive,
        disabled: entry.disabled,
      },
    };
  });
  return { actions, handlers };
}
