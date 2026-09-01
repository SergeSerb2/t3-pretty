import { isElectron } from "~/env";
import { SURGE_CODE_ACCOUNT_NAME } from "@t3tools/shared/connectBranding";
import { isWindowsPlatform } from "~/lib/utils";

import { WORLD_SCENERY_THEME_ID } from "../../scenery/worldSceneryTheme";

export type SettingsPath =
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/keybindings"
  | "/settings/providers"
  | "/settings/instructions"
  | "/settings/agents"
  | "/settings/skills"
  | "/settings/apps"
  | "/settings/integrations"
  | "/settings/source-control"
  | "/settings/storage"
  | "/settings/connections"
  | "/settings/archived";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
  // Its row only renders in the desktop app, so a browser result would land on
  // an anchor that isn't there.
  readonly desktopOnly?: boolean;
  // Its row only renders under the World Scenery theme, same anchor problem.
  readonly sceneryOnly?: boolean;
  // Its row only renders on Windows desktop, so other desktop platforms must
  // not expose a result that points to a missing anchor.
  readonly windowsOnly?: boolean;
}

/**
 * Section labels in sidebar order. The sidebar nav and the search-result
 * subtitles both render from this record, so each label exists once.
 */
export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPath, string>> = {
  "/settings/general": "General",
  "/settings/appearance": "Appearance",
  "/settings/keybindings": "Keybindings",
  "/settings/providers": "Providers",
  "/settings/instructions": "Instructions",
  "/settings/agents": "Agents",
  "/settings/skills": "Skills",
  "/settings/apps": "Apps",
  "/settings/integrations": "Integrations",
  "/settings/source-control": "Source Control",
  "/settings/storage": "Storage",
  "/settings/connections": "Connections",
  "/settings/archived": "Archive",
};

/**
 * Every searchable setting, in result order. This catalog is the single
 * source of truth for anchor ids and visible titles: panels render both via
 * `searchableSetting`, so a retitle (or, later, a translation pass) happens
 * here once instead of separately in the panel and the index.
 */
export const SETTINGS_SEARCH_ITEMS = [
  {
    id: "color-scheme",
    title: "Color scheme",
    to: "/settings/appearance",
    // The scheme tiles sit at the top of the Appearance section.
    targetId: "appearance",
  },
  {
    id: "personalization",
    title: "Personalization",
    to: "/settings/appearance",
    targetId: "appearance",
  },
  {
    id: "theme",
    title: "World Scenery theme",
    to: "/settings/appearance",
    targetId: "appearance",
  },
  {
    id: "world-scenery",
    title: "World Scenery",
    to: "/settings/appearance",
    targetId: "appearance",
  },
  {
    id: "night-cities",
    title: "Night Cities",
    to: "/settings/appearance",
    targetId: "appearance",
  },
  {
    id: "deep-forest",
    title: "Deep Forest",
    to: "/settings/appearance",
    targetId: "appearance",
  },
  {
    id: "night-sky",
    title: "Night Sky",
    to: "/settings/appearance",
    targetId: "appearance",
  },
  {
    id: "grand-buildings",
    title: "Grand Buildings",
    to: "/settings/appearance",
    targetId: "appearance",
  },
  {
    id: "boring-mode",
    title: "Boring",
    to: "/settings/appearance",
    targetId: "appearance",
  },
  {
    // Prefixed because the slider control already owns the `appearance-contrast` id.
    id: "setting-appearance-contrast",
    title: "Contrast",
    to: "/settings/appearance",
  },
  {
    // Prefixed because the slider control already owns the `glass-opacity` id.
    id: "setting-glass-opacity",
    title: "Glass opacity",
    to: "/settings/appearance",
  },
  {
    id: "setting-photo-blur",
    title: "Photo blur",
    to: "/settings/appearance",
    sceneryOnly: true,
  },
  {
    id: "setting-photo-presence",
    title: "Photo presence",
    to: "/settings/appearance",
    sceneryOnly: true,
  },
  {
    id: "setting-scenery-motion",
    title: "Thread motion",
    to: "/settings/appearance",
    sceneryOnly: true,
  },
  {
    id: "setting-scenery-text-color",
    title: "Scenery text color",
    to: "/settings/appearance",
    sceneryOnly: true,
  },
  {
    id: "environment-identification",
    title: "Environment identification",
    to: "/settings/appearance",
    // The setting is stage-dependent, so its parent section is the stable destination.
    targetId: "appearance",
  },
  {
    id: "interface-font",
    title: "Interface font",
    to: "/settings/appearance",
  },
  {
    id: "prompt-font",
    title: "Prompt font",
    to: "/settings/appearance",
  },
  {
    id: "code-font",
    title: "Code font",
    to: "/settings/appearance",
  },
  {
    id: "terminal-font",
    title: "Terminal font",
    to: "/settings/appearance",
  },
  {
    id: "font-smoothing",
    title: "Font smoothing",
    to: "/settings/appearance",
  },
  {
    id: "word-wrap",
    title: "Word wrap",
    to: "/settings/appearance",
  },
  {
    id: "project-grouping",
    title: "Project grouping",
    to: "/settings/general",
  },
  {
    id: "auto-generate-project-icons",
    title: "Auto-generate project icons",
    to: "/settings/general",
  },
  {
    id: "auto-settle-inactive-threads",
    title: "Auto-settle inactive threads",
    to: "/settings/general",
  },
  {
    id: "auto-archive-settled-threads",
    title: "Auto-archive settled threads",
    to: "/settings/general",
  },
  {
    id: "time-format",
    title: "Time format",
    to: "/settings/general",
  },
  {
    id: "hide-whitespace-changes",
    title: "Hide whitespace changes",
    to: "/settings/general",
  },
  {
    id: "skills-in-slash-menu",
    title: "Show skills in slash menu",
    to: "/settings/general",
  },
  {
    id: "provider-update-checks",
    title: "Provider update checks",
    to: "/settings/general",
  },
  {
    id: "new-threads",
    title: "New threads",
    to: "/settings/general",
  },
  {
    id: "start-from-origin",
    title: "Start from origin",
    to: "/settings/general",
    targetId: "new-threads",
  },
  {
    id: "add-project-starts-in",
    title: "Add project starts in",
    to: "/settings/general",
  },
  {
    id: "unpin-confirmation",
    title: "Unpin confirmation",
    to: "/settings/general",
  },
  {
    id: "archive-confirmation",
    title: "Archive confirmation",
    to: "/settings/general",
  },
  {
    id: "delete-confirmation",
    title: "Delete confirmation",
    to: "/settings/general",
  },
  {
    id: "quit-confirmation",
    title: "Hold to quit",
    to: "/settings/general",
    desktopOnly: true,
  },
  {
    id: "text-generation-model",
    title: "Text generation model",
    to: "/settings/general",
  },
  {
    id: "live-activity-headlines",
    title: "Live activity headlines",
    to: "/settings/general",
  },
  {
    id: "diagnostics",
    title: "Diagnostics",
    to: "/settings/general",
  },
  {
    id: "whats-new",
    title: "What's new",
    to: "/settings/general",
  },
  {
    id: "legacy-plan-mode",
    title: "Plan mode (legacy)",
    to: "/settings/general",
  },
  {
    id: "legacy-token-streaming",
    title: "Stream token by token (legacy)",
    to: "/settings/general",
  },
  {
    id: "legacy-sidebar",
    title: "Sidebar (legacy)",
    to: "/settings/general",
  },
  {
    id: "keybindings",
    title: "Keybindings",
    to: "/settings/keybindings",
  },
  {
    id: "providers",
    title: "Providers",
    to: "/settings/providers",
  },
  {
    id: "agent-instructions-global",
    title: "Global agent instructions",
    to: "/settings/instructions",
  },
  {
    id: "agent-instructions-project",
    title: "Project agent instructions",
    to: "/settings/instructions",
  },
  {
    id: "subagents-enabled",
    title: "Use subagents",
    to: "/settings/agents",
  },
  {
    id: "subagents-default-child",
    title: "Default child model",
    to: "/settings/agents",
  },
  {
    id: "skills-installed",
    title: "Installed skills",
    to: "/settings/skills",
  },
  {
    id: "skills-on-environment",
    title: "On this environment",
    to: "/settings/skills",
  },
  {
    id: "skills-marketplace",
    title: "Skills marketplace",
    to: "/settings/skills",
  },
  {
    id: "apps-connected",
    title: "Connected apps",
    to: "/settings/apps",
  },
  {
    id: "apps-browse",
    title: "Browse apps",
    to: "/settings/apps",
  },
  {
    id: "apps-oauth-clients",
    title: "OAuth clients",
    to: "/settings/apps",
  },
  {
    id: "agent-browser-access",
    title: "Agent browser access",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "agent-computer-control",
    title: "Agent computer control",
    to: "/settings/integrations",
    targetId: "computer-control",
  },
  {
    id: "browser-default-viewport",
    title: "Default browser viewport",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-default-zoom",
    title: "Default browser zoom",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-default-appearance",
    title: "Default browser appearance",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-recording-frame-rate",
    title: "Browser recording frame rate",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-auto-show-floating-preview",
    title: "Auto-show floating preview",
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "source-control",
    title: "Source control",
    to: "/settings/source-control",
  },
  {
    id: "storage-disk-use",
    title: "Disk use",
    to: "/settings/storage",
  },
  {
    id: "storage-cleanup",
    title: "Cleanup",
    to: "/settings/storage",
  },
  {
    id: "storage-active-worktrees",
    title: "Active worktrees",
    to: "/settings/storage",
  },
  {
    id: "storage-archived-worktrees",
    title: "Archived worktrees",
    to: "/settings/storage",
  },
  {
    id: "storage-residual",
    title: "Residual managed files",
    to: "/settings/storage",
  },
  {
    id: "surge-connect-account",
    title: `${SURGE_CODE_ACCOUNT_NAME} account`,
    to: "/settings/connections",
  },
  {
    id: "remote-environments",
    title: "Remote environments",
    to: "/settings/connections",
  },
  {
    id: "wsl-backend",
    title: "WSL backend",
    to: "/settings/connections",
    desktopOnly: true,
    windowsOnly: true,
  },
  {
    id: "archive",
    title: "Archived threads",
    to: "/settings/archived",
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const SEARCH_ITEMS_BY_ID = Object.fromEntries(
  SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item]),
) as Readonly<Record<SettingsSearchItemId, SettingsSearchItem>>;

/**
 * `id` and `title` props for the element a search item anchors to. Panels
 * spread (or pick from) this instead of restating the strings, so the catalog
 * and the rendered settings cannot drift apart.
 */
export function searchableSetting(id: SettingsSearchItemId): {
  readonly id: string;
  readonly title: string;
} {
  const { id: anchorId, title } = SEARCH_ITEMS_BY_ID[id];
  return { id: anchorId, title };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];

  const sceneryActive =
    typeof document !== "undefined" &&
    document.documentElement.dataset.themeId === WORLD_SCENERY_THEME_ID;

  return items.filter(
    (item) =>
      (isElectron || item.desktopOnly !== true) &&
      (sceneryActive || item.sceneryOnly !== true) &&
      (!item.windowsOnly ||
        isWindowsPlatform(typeof navigator === "undefined" ? "" : navigator.platform)) &&
      normalizeSearchText(item.title).includes(normalizedQuery),
  );
}
