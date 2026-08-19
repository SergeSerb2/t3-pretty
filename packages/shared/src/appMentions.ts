/**
 * `@slug` app mentions in a user message. Shares the composer's bare-mention
 * grammar (`@word` bounded by whitespace) but only ever resolves against the
 * enabled apps handed in, so a stray `@src/foo` file mention never matches.
 */
import type { AppConnection } from "@t3tools/contracts";

const APP_MENTION_PATTERN = /(^|\s)@([a-z0-9][a-z0-9_-]{0,31})(?=\s|$)/gi;

/** Enabled apps mentioned in `text`, first-seen order, deduped. */
export function extractAppMentions(
  text: string,
  apps: ReadonlyArray<AppConnection>,
): ReadonlyArray<AppConnection> {
  if (apps.length === 0 || !text.includes("@")) return [];
  const bySlug = new Map(apps.map((app) => [app.slug, app] as const));
  const seen = new Set<string>();
  const mentioned: AppConnection[] = [];
  for (const match of text.matchAll(APP_MENTION_PATTERN)) {
    const slug = match[2]?.toLowerCase();
    if (!slug || seen.has(slug)) continue;
    const app = bySlug.get(slug);
    if (!app) continue;
    seen.add(slug);
    mentioned.push(app);
  }
  return mentioned;
}

/**
 * Prelude prepended to a turn that @mentions apps. Short on purpose: the
 * tools themselves are already in the provider's MCP tool list; this only
 * ties the mention to the server name the tools are namespaced under.
 */
export function renderAppMentionsPrelude(apps: ReadonlyArray<AppConnection>): string | undefined {
  if (apps.length === 0) return undefined;
  const lines = apps.map(
    (app) => `- @${app.slug} → ${app.name}: use the tools from the MCP server named "${app.slug}".`,
  );
  return ["[Connected apps]", ...lines, "[End connected apps]"].join("\n");
}
