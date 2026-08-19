/**
 * Brand mark for an app. Renders the service favicon and falls back to a
 * monogram on the catalog's brand color when the favicon can't load (offline,
 * blocked, or a custom MCP server with no catalog entry at all).
 */
import { useState } from "react";
import type { AppCatalogEntry, AppConnection } from "@t3tools/contracts";
import { findAppCatalogEntry } from "@t3tools/contracts";

import { cn } from "~/lib/utils";

/** Neutral background for connections without a catalog entry. */
const CUSTOM_APP_COLOR = "#6b7280";

export interface AppPresentation {
  readonly name: string;
  readonly color: string;
  /** `null` renders the monogram directly — custom servers have no brand icon. */
  readonly iconDomain: string | null;
}

/** How a stored connection should look, catalog-backed or custom. */
export function appPresentation(connection: AppConnection): AppPresentation {
  const entry = findAppCatalogEntry(connection.catalogId);
  return {
    name: connection.name,
    color: entry?.color ?? CUSTOM_APP_COLOR,
    iconDomain: entry?.iconDomain ?? null,
  };
}

export function AppIcon({
  entry,
  name,
  color,
  iconDomain,
  size = 32,
  className,
}: {
  entry?: AppCatalogEntry;
  name?: string;
  color?: string;
  iconDomain?: string | null;
  size?: number;
  className?: string;
}) {
  const [failedDomain, setFailedDomain] = useState<string | null>(null);
  const label = (entry?.name ?? name ?? "").trim();
  const domain = entry?.iconDomain ?? iconDomain ?? null;
  const box = { width: size, height: size };

  if (domain === null || domain === failedDomain) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 select-none items-center justify-center rounded-md font-semibold text-white",
          className,
        )}
        style={{
          ...box,
          backgroundColor: entry?.color ?? color ?? CUSTOM_APP_COLOR,
          fontSize: Math.round(size * 0.45),
        }}
      >
        {label.charAt(0).toUpperCase() || "?"}
      </span>
    );
  }

  return (
    <img
      src={`https://${domain}/favicon.ico`}
      alt=""
      loading="lazy"
      width={size}
      height={size}
      style={box}
      className={cn("shrink-0 rounded-md bg-white/4 object-contain", className)}
      onError={() => setFailedDomain(domain)}
    />
  );
}
