/**
 * Pure helpers behind Settings › Apps: slug derivation, connection status,
 * catalog browsing, and the `AppConnectionInput` records the `apps.upsert` RPC
 * takes. Everything here is deterministic so the panel stays a thin renderer.
 */
import {
  APP_CATALOG,
  APP_CATEGORY_LABELS,
  findAppCatalogEntry,
  findAppOAuthClientFamily,
  type AppAuthKind,
  type AppCatalogEntry,
  type AppCategory,
  type AppConnection,
  type AppConnectionId,
  type AppConnectionInput,
  type AppsSettings,
} from "@t3tools/contracts";

/** Mirrors the `AppSlug` schema; the server rejects anything else. */
export const APP_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const APP_SLUG_MAX_LENGTH = 32;

/**
 * Path the server serves the OAuth redirect from. Lives in the server's
 * `AppsService`, which clients cannot import, so it is restated here.
 */
export function appsRedirectUri(callbackOrigin: string): string {
  return `${callbackOrigin}/api/apps/oauth/callback`;
}

export function isValidAppSlug(slug: string): boolean {
  return APP_SLUG_PATTERN.test(slug);
}

function parseHttpsUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** Best-effort slug for a display name; empty when nothing usable survives. */
export function deriveAppSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, APP_SLUG_MAX_LENGTH);
}

/** `deriveAppSlug` plus a `-2`, `-3`, … suffix until the slug is free. */
export function uniqueAppSlug(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = deriveAppSlug(name) || "app";
  if (!used.has(root)) return root;
  for (let attempt = 2; ; attempt += 1) {
    const suffix = `-${attempt}`;
    const candidate = `${root.slice(0, APP_SLUG_MAX_LENGTH - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

export type AppConnectionStatus = "connected" | "needs-oauth-client" | "disconnected";

export const APP_STATUS_LABELS: Readonly<Record<AppConnectionStatus, string>> = {
  connected: "Connected",
  "needs-oauth-client": "Needs setup",
  disconnected: "Not connected",
};

/**
 * OAuth client family the user must register themselves before this catalog
 * app can be authorized, or `null` when the server handles registration.
 */
export function appOAuthClientFamilyId(catalogId: string | null): string | null {
  return findAppCatalogEntry(catalogId)?.oauthClientFamily ?? null;
}

export function appConnectionStatus(
  connection: AppConnection,
  oauthClients: AppsSettings["oauthClients"],
): AppConnectionStatus {
  if (connection.auth === "none" || connection.authorizedAt !== null) return "connected";
  if (connection.auth === "oauth") {
    const family = appOAuthClientFamilyId(connection.catalogId);
    if (family !== null && oauthClients[family] === undefined) return "needs-oauth-client";
  }
  return "disconnected";
}

/** The client-writable half of a stored record, ready for `apps.upsert`. */
export function appConnectionInput(connection: AppConnection): AppConnectionInput {
  const { id, catalogId, name, slug, url, auth, scopes, tokenHeader, enabled } = connection;
  return { id, catalogId, name, slug, url, auth, scopes, tokenHeader, enabled };
}

/** New connection for a catalog entry, with a slug that no sibling uses. */
export function catalogConnectionInput(
  entry: AppCatalogEntry,
  takenSlugs: Iterable<string>,
  auth: AppAuthKind,
  id: AppConnectionId,
): AppConnectionInput {
  return {
    id,
    catalogId: entry.id,
    name: entry.name,
    slug: uniqueAppSlug(entry.id, takenSlugs),
    url: entry.url,
    auth,
    scopes: entry.scopes ?? "",
    tokenHeader: entry.tokenHeader ?? "Authorization",
    enabled: true,
  };
}

export interface AppConnectionDraft {
  readonly name: string;
  readonly slug: string;
  readonly url: string;
  readonly auth: AppAuthKind;
  readonly scopes: string;
  readonly tokenHeader: string;
}

/** First problem stopping a draft from being saved, or `null` when it's valid. */
export function appDraftError(
  draft: AppConnectionDraft,
  takenSlugs: ReadonlySet<string>,
): string | null {
  const name = draft.name.trim();
  if (name.length === 0) return "Name is required.";
  if (name.length > 64) return "Name must be 64 characters or fewer.";
  if (!isValidAppSlug(draft.slug)) {
    return "Slug must start with a letter or number and use only lowercase letters, numbers, dashes or underscores.";
  }
  if (takenSlugs.has(draft.slug)) return `Another app already uses "@${draft.slug}".`;
  const url = draft.url.trim();
  if (url.length === 0) return "URL is required.";
  if (parseHttpsUrl(url) === null) return "Enter an https:// URL.";
  if (draft.auth === "token" && draft.tokenHeader.trim().length === 0) {
    return "Token header is required.";
  }
  return null;
}

export function sortedAppConnections(
  connections: AppsSettings["connections"],
): ReadonlyArray<AppConnection> {
  return Object.values(connections).sort((left, right) => left.name.localeCompare(right.name));
}

export const APP_CATEGORY_FILTERS: ReadonlyArray<{
  readonly id: AppCategory | "all";
  readonly label: string;
}> = [
  { id: "all", label: "All" },
  ...(Object.keys(APP_CATEGORY_LABELS) as ReadonlyArray<AppCategory>).map((id) => ({
    id,
    label: APP_CATEGORY_LABELS[id],
  })),
];

export function filterAppCatalog(
  query: string,
  category: AppCategory | "all",
  entries: ReadonlyArray<AppCatalogEntry> = APP_CATALOG,
): ReadonlyArray<AppCatalogEntry> {
  const needle = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (category !== "all" && entry.category !== category) return false;
    if (needle.length === 0) return true;
    return (
      entry.name.toLowerCase().includes(needle) ||
      entry.description.toLowerCase().includes(needle) ||
      entry.id.includes(needle) ||
      APP_CATEGORY_LABELS[entry.category].toLowerCase().includes(needle)
    );
  });
}

/** One-line sign-in hint for a catalog card. */
export function appAuthHint(
  entry: AppCatalogEntry,
  oauthClients: AppsSettings["oauthClients"],
): string {
  if (entry.auth === "none") return "No sign-in";
  if (
    entry.auth === "oauth" &&
    entry.oauthClientFamily !== undefined &&
    oauthClients[entry.oauthClientFamily] === undefined
  ) {
    const family = findAppOAuthClientFamily(entry.oauthClientFamily);
    return `Needs ${family?.name ?? entry.oauthClientFamily}`;
  }
  return entry.auth === "token" ? "API token" : "OAuth";
}

/** Catalog ids already connected, so browse cards can show "Added". */
export function connectedCatalogIds(connections: AppsSettings["connections"]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const connection of Object.values(connections)) {
    if (connection.catalogId !== null) ids.add(connection.catalogId);
  }
  return ids;
}
