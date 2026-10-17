import { use } from "react";
import { Platform } from "react-native";

import { NativePrimaryColumnContext } from "../../native/v5-workspace-context";
import { NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED } from "../layout/native-mail-search-toolbar";
import { useWorkspaceTabs } from "../workspace/WorkspaceTabsContext";

/** Workspace roots own their native header, search, and compose controls. */
export function useHomeTopBarActive(): boolean {
  const primaryColumn = use(NativePrimaryColumnContext);
  const workspace = useWorkspaceTabs();
  return (
    workspace === null &&
    Platform.OS === "ios" &&
    !(Platform.isPad && primaryColumn !== null) &&
    !NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED
  );
}
