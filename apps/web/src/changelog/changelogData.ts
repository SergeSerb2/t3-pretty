/**
 * The in-app changelog shown by the What's New dialog after an update.
 *
 * Add a new release at the TOP of the list when preparing a release. Keep
 * entries user-facing: what someone using the app would notice, not internal
 * refactors. Dates are ISO (YYYY-MM-DD); versions match apps/web/package.json.
 */

export type ChangelogItemKind = "new" | "improved" | "fixed";

export interface ChangelogItem {
  readonly kind: ChangelogItemKind;
  readonly title: string;
  readonly description?: string;
}

export interface ChangelogRelease {
  readonly version: string;
  readonly date: string;
  readonly headline?: string;
  readonly items: readonly ChangelogItem[];
}

export const CHANGELOG_RELEASES: readonly ChangelogRelease[] = [
  {
    version: "0.0.33",
    date: "2026-08-10",
    items: [
      {
        kind: "new",
        title: "Agent instruction files in Settings",
        description:
          "View and edit AGENTS.md and other agent instruction files from Settings → Instructions, without leaving the app.",
      },
    ],
  },
  {
    version: "0.0.32",
    date: "2026-08-07",
    items: [
      {
        kind: "new",
        title: "Configurable fonts and sizes",
        description:
          "Pick interface, prompt, and code fonts — and their sizes — under Settings → Appearance.",
      },
      {
        kind: "new",
        title: "Ghostty-powered terminals",
        description: "Terminal output now renders with libghostty-vt for crisper, faster display.",
      },
      {
        kind: "fixed",
        title: "Steadier chat timeline",
        description: "Messages no longer shift position while a thread streams in.",
      },
    ],
  },
  {
    version: "0.0.31",
    date: "2026-07-29",
    items: [
      {
        kind: "improved",
        title: "Smaller desktop app",
        description: "The installed desktop app is about 300 MB lighter.",
      },
      {
        kind: "improved",
        title: "Less idle CPU and disk churn",
        description: "Native resource diagnostics cut background work while the app sits idle.",
      },
      {
        kind: "fixed",
        title: "Markdown view choice sticks",
        description: "The rendered-markdown toggle is remembered across threads.",
      },
      {
        kind: "fixed",
        title: "Git repositories detected after init",
        description: "Initializing a repository in an open project is picked up right away.",
      },
    ],
  },
];
