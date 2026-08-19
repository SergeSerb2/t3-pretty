/**
 * `@slug` app mentions in the composer. The `@` menu offers attachable apps,
 * and the prompt editor draws a chip for any mention whose text matches one —
 * hence the module store: chips live deep inside the editor's decorators,
 * where threading the app list through would mean re-rendering the editor.
 */
import type { AppConnection } from "@t3tools/contracts";
import { create } from "zustand";

import { appPresentation } from "../apps/AppIcon";

export type ComposerAppMention = {
  slug: string;
  name: string;
  color: string;
  iconDomain: string | null;
};

/** Apps attach to a session once they are on and hold a credential. */
export function isAttachableApp(app: AppConnection): boolean {
  return app.enabled && (app.auth === "none" || app.authorizedAt !== null);
}

const MAX_APP_MENTION_SUGGESTIONS = 8;

/** Attachable apps matching an `@` query, prefix matches first, then by name. */
export function searchAppMentions(
  apps: ReadonlyArray<AppConnection>,
  query: string,
  limit = MAX_APP_MENTION_SUGGESTIONS,
): AppConnection[] {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? apps.filter((app) => app.slug.includes(needle) || app.name.toLowerCase().includes(needle))
    : [...apps];
  const isPrefixMatch = (app: AppConnection) =>
    needle !== "" && (app.slug.startsWith(needle) || app.name.toLowerCase().startsWith(needle));
  return matches
    .sort(
      (left, right) =>
        Number(isPrefixMatch(right)) - Number(isPrefixMatch(left)) ||
        left.name.localeCompare(right.name),
    )
    .slice(0, limit);
}

const useAppMentionStore = create<{ bySlug: ReadonlyMap<string, ComposerAppMention> }>(() => ({
  bySlug: new Map(),
}));

/** Publish the apps whose slugs render as chips. Idempotent: equal input is a no-op. */
export function setComposerAppMentions(apps: ReadonlyArray<AppConnection>): void {
  const current = useAppMentionStore.getState().bySlug;
  const next = new Map(
    apps.map((app) => [app.slug, { slug: app.slug, ...appPresentation(app) }] as const),
  );
  const unchanged =
    next.size === current.size &&
    [...next].every(([slug, mention]) => {
      const existing = current.get(slug);
      return (
        existing !== undefined &&
        existing.name === mention.name &&
        existing.color === mention.color &&
        existing.iconDomain === mention.iconDomain
      );
    });
  if (unchanged) return;
  useAppMentionStore.setState({ bySlug: next });
}

/** Non-reactive lookup, for Lexical node serialization. */
export function getComposerAppMention(slug: string): ComposerAppMention | undefined {
  return useAppMentionStore.getState().bySlug.get(slug);
}

export function useComposerAppMention(slug: string): ComposerAppMention | undefined {
  return useAppMentionStore((state) => state.bySlug.get(slug));
}
