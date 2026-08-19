/**
 * Pure rules behind Settings → Apps and the composer's `@app` mentions:
 * slug generation, status copy, catalog filtering, and the record-to-input
 * conversion every `apps.upsert` call needs. No React, no atoms.
 */
import {
  APP_CATALOG,
  APP_CATEGORY_LABELS,
  findAppCatalogEntry,
  type AppAuthKind,
  type AppCatalogEntry,
  type AppCategory,
  type AppConnection,
  type AppConnectionId,
  type AppConnectionInput,
  type AppsSettings,
} from "@t3tools/contracts";

/** Mirrors `AppSlug` in the contracts so the custom-server form can validate locally. */
export const APP_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const APP_SLUG_MAX_LENGTH = 32;

/** Avatar background for custom MCP servers, which have no catalog brand color. */
export const CUSTOM_APP_COLOR = "#6B7280";

/** The client-settable half of a stored record, ready to send back unchanged. */
export function appConnectionInput(connection: AppConnection): AppConnectionInput {
  return {
    id: connection.id,
    catalogId: connection.catalogId,
    name: connection.name,
    slug: connection.slug,
    url: connection.url,
    auth: connection.auth,
    scopes: connection.scopes,
    tokenHeader: connection.tokenHeader,
    enabled: connection.enabled,
  };
}

/** True when this app's tools actually reach agents. */
export function isAppAttachable(connection: AppConnection): boolean {
  return connection.enabled && (connection.auth === "none" || connection.authorizedAt !== null);
}

/**
 * OAuth client family this connection still needs configured, or `null` when
 * it can authorize as-is (dynamic client registration, token, or open server).
 */
export function requiredOAuthClientFamily(
  connection: Pick<AppConnection, "auth" | "catalogId">,
  oauthClients: AppsSettings["oauthClients"],
): string | null {
  if (connection.auth !== "oauth") return null;
  const family = findAppCatalogEntry(connection.catalogId)?.oauthClientFamily;
  if (family === undefined) return null;
  return oauthClients[family] === undefined ? family : null;
}

export type AppStatusTone = "connected" | "error" | "muted";

export interface AppStatus {
  readonly label: string;
  readonly tone: AppStatusTone;
}

export function appConnectionStatus(
  connection: AppConnection,
  oauthClients: AppsSettings["oauthClients"],
): AppStatus {
  if (connection.lastError !== null) return { label: connection.lastError, tone: "error" };
  if (connection.auth === "none") {
    return connection.enabled
      ? { label: "Ready", tone: "connected" }
      : { label: "Off", tone: "muted" };
  }
  if (connection.authorizedAt !== null) {
    return connection.enabled
      ? { label: "Connected", tone: "connected" }
      : { label: "Connected · off", tone: "muted" };
  }
  if (requiredOAuthClientFamily(connection, oauthClients) !== null) {
    return { label: "Needs setup", tone: "error" };
  }
  return { label: "Not connected", tone: "muted" };
}

/** Coerce free text (an app name, a catalog id) into something `AppSlug` accepts. */
export function normalizeAppSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[-_]+$/, "")
    .slice(0, APP_SLUG_MAX_LENGTH);
}

export function isValidAppSlug(value: string): boolean {
  return APP_SLUG_PATTERN.test(value);
}

/** `gmail`, then `gmail-2`, `gmail-3`, … against the slugs already in use. */
export function uniqueAppSlug(base: string, taken: Iterable<string>): string {
  const normalized = normalizeAppSlug(base) || "app";
  const used = new Set(taken);
  let candidate = normalized;
  for (let suffix = 2; used.has(candidate); suffix += 1) {
    const tail = `-${suffix}`;
    candidate = `${normalized.slice(0, APP_SLUG_MAX_LENGTH - tail.length)}${tail}`;
  }
  return candidate;
}

/** Which connect paths a catalog entry offers; both means the user picks. */
export function appAuthChoices(entry: AppCatalogEntry): {
  readonly oauth: boolean;
  readonly token: boolean;
} {
  return {
    oauth: entry.auth === "oauth" || entry.oauthClientFamily !== undefined,
    token: entry.auth === "token" || entry.tokenSupported === true,
  };
}

export function catalogConnectionInput(input: {
  readonly id: AppConnectionId;
  readonly entry: AppCatalogEntry;
  readonly auth: AppAuthKind;
  readonly takenSlugs: Iterable<string>;
}): AppConnectionInput {
  return {
    id: input.id,
    catalogId: input.entry.id,
    name: input.entry.name,
    slug: uniqueAppSlug(input.entry.id, input.takenSlugs),
    url: input.entry.url,
    auth: input.auth,
    scopes: input.auth === "oauth" ? (input.entry.scopes ?? "") : "",
    tokenHeader: input.entry.tokenHeader ?? "Authorization",
    enabled: true,
  };
}

export interface AppCatalogGroup {
  readonly category: AppCategory;
  readonly label: string;
  readonly entries: ReadonlyArray<AppCatalogEntry>;
}

/** Catalog filtered by free text, grouped in `APP_CATEGORY_LABELS` order. */
export function appCatalogGroups(query: string): ReadonlyArray<AppCatalogGroup> {
  const needle = query.trim().toLowerCase();
  const matches =
    needle === ""
      ? APP_CATALOG
      : APP_CATALOG.filter(
          (entry) =>
            entry.name.toLowerCase().includes(needle) ||
            entry.id.includes(needle) ||
            entry.description.toLowerCase().includes(needle),
        );
  const categories = Object.keys(APP_CATEGORY_LABELS) as ReadonlyArray<AppCategory>;
  return categories
    .map((category) => ({
      category,
      label: APP_CATEGORY_LABELS[category],
      entries: matches.filter((entry) => entry.category === category),
    }))
    .filter((group) => group.entries.length > 0);
}

export function sortedAppConnections(apps: AppsSettings): ReadonlyArray<AppConnection> {
  return Object.values(apps.connections).sort((left, right) => left.name.localeCompare(right.name));
}

/** Composer `@` candidates: attachable apps matched on slug or name. */
export function attachableAppMatches(
  apps: AppsSettings,
  query: string,
  limit: number,
): ReadonlyArray<AppConnection> {
  const needle = query.trim().toLowerCase().replace(/^@+/, "");
  const attachable = sortedAppConnections(apps).filter(isAppAttachable);
  return (
    needle === ""
      ? attachable
      : attachable.filter(
          (connection) =>
            connection.slug.includes(needle) || connection.name.toLowerCase().includes(needle),
        )
  ).slice(0, limit);
}

export function appMonogram(name: string): string {
  return (name.trim().at(0) ?? "?").toUpperCase();
}

export function appAvatarColor(catalogId: string | null): string {
  return findAppCatalogEntry(catalogId)?.color ?? CUSTOM_APP_COLOR;
}

/** Redirect URI the user must register with the upstream OAuth console. */
export function appsOAuthRedirectUri(callbackOrigin: string): string {
  return `${callbackOrigin}/api/apps/oauth/callback`;
}

/**
 * Origin this device reaches an environment server through. The OAuth redirect
 * lands on `<origin>/api/apps/oauth/callback`, so it must be the URL this
 * client actually talks to, not the server's own idea of its address.
 */
export function appsCallbackOrigin(httpBaseUrl: string | undefined): string | null {
  if (httpBaseUrl === undefined || httpBaseUrl === "") return null;
  try {
    return new URL(httpBaseUrl).origin;
  } catch {
    return null;
  }
}
