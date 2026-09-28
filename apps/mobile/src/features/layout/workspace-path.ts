import type { NavigationState } from "@react-navigation/native";

// Routes presented as sheets/overlays on top of the workspace. They must not
// influence adaptive workspace layout: Settings over Home remains Home.
const WORKSPACE_OVERLAY_ROUTES = new Set([
  "ConnectOnboarding",
  "Connections",
  "ConnectionsNew",
  "GitBranches",
  "GitCommit",
  "GitConfirm",
  "GitOverview",
  "NewTaskSheet",
  "PullRequestComment",
  "PullRequestReviewers",
  "SettingsLegal",
  "SettingsSheet",
  "ThreadReviewComment",
  "ThreadSettingsSheet",
]);

/** Pathname of the topmost non-overlay route beneath any presented sheets. */
export function workspacePathFromState(
  state: NavigationState,
  getPath: (state: NavigationState) => string,
): string {
  const routes = state.routes.filter((route) => !WORKSPACE_OVERLAY_ROUTES.has(route.name));
  if (routes.length === 0) return "/";

  const effectiveState =
    routes.length === state.routes.length
      ? state
      : ({ ...state, routes, index: routes.length - 1 } as NavigationState);
  const path = getPath(effectiveState);
  return path.startsWith("/") ? path : `/${path}`;
}
