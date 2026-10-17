import type { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { providerAuthReturnUrl } from "@t3tools/shared/providerAuthReturnUrl";

export function readCodexSetupMode(config: unknown): "managed" | "existing" {
  return config !== null &&
    typeof config === "object" &&
    "setupMode" in config &&
    config.setupMode === "managed"
    ? "managed"
    : "existing";
}

/** The provider sign-in return keeps the selected machine or provider instance. */
export function codexSetupReturnUrl(
  href: string,
  environmentId: EnvironmentId,
  instanceId: ProviderInstanceId,
): URL {
  const url = new URL(providerAuthReturnUrl(href) ?? href);
  if (url.pathname === "/welcome") url.hash = `agents:${environmentId}`;
  if (url.pathname === "/settings/providers") url.searchParams.set("instanceId", instanceId);
  return url;
}
