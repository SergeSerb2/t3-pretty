import type { MenuAction } from "@react-native-menu/menu";

/** Row-menu entry for manual rename; sits next to "Regenerate title". */
export const THREAD_RENAME_MENU_ACTION: MenuAction = {
  id: "rename",
  title: "Rename thread",
  image: "pencil",
};

/** thread.meta.update takes a TrimmedNonEmptyString; empty input is a no-op. */
export function normalizeThreadTitleInput(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
