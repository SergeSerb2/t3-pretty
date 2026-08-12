/**
 * The in-app changelog shown by the What's New sheet after an update.
 *
 * Add a new release at the TOP of the list when preparing a release. Keep
 * entries user-facing and mobile-relevant: what someone using the phone app
 * would notice, not internal refactors. Dates are ISO (YYYY-MM-DD); versions
 * match the T3 Pretty release train (see resolveMobileAppVersion in
 * app.config.ts).
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
    version: "0.0.34",
    date: "2026-08-10",
    headline: "Meet T3 Pretty",
    items: [
      {
        kind: "new",
        title: "World Scenery look",
        description:
          "The full World Scenery theme from the desktop app: every thread gets its own landscape photo behind the chat, the threads list shows a new featured place each day, and Blur / Photo presence controls live in Settings → Appearance.",
      },
      {
        kind: "new",
        title: "T3 Pretty identity",
        description:
          "The app is now T3 Pretty: new icon, new name, and Surge Connect as the built-in cloud relay.",
      },
      {
        kind: "new",
        title: "Native pull requests",
        description:
          "Browse, review, merge, and resolve conflicts on pull requests in the app — no browser required. Open them from the home header, the sidebar, or a thread's git controls.",
      },
      {
        kind: "new",
        title: "What's New",
        description: "Release notes now appear right here after each update.",
      },
    ],
  },
];
