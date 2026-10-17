import {
  buildConnectAuthorizeRequestUrl,
  DEFAULT_HOSTED_APP_URL,
  readConnectAuthorizeRequest,
} from "@t3tools/shared/connectAuth";
import { clerkFrontendApiHostnameFromPublishableKey } from "@t3tools/shared/relayAuth";

import { isElectron } from "../env";

/**
 * The official production Clerk instance cannot issue browser sessions to
 * localhost or a fork's static host. Use the official web app there; Electron
 * keeps its native SDK, and custom Clerk instances keep their own policy.
 */
export function connectBrowserAuthHandoffUrl(): string | null {
  const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  if (isElectron || !key?.startsWith("pk_live_") || typeof window === "undefined") return null;
  try {
    if (clerkFrontendApiHostnameFromPublishableKey(key) !== "clerk.t3.codes") return null;
  } catch {
    return null;
  }
  const currentUrl = new URL(window.location.href);
  if (
    currentUrl.protocol === "https:" &&
    currentUrl.port === "" &&
    (currentUrl.hostname === "t3.codes" || currentUrl.hostname.endsWith(".t3.codes"))
  ) {
    return null;
  }

  const request = /\/connect\/?$/.test(currentUrl.pathname)
    ? readConnectAuthorizeRequest(currentUrl)
    : null;
  return request
    ? buildConnectAuthorizeRequestUrl({ hostedAppUrl: DEFAULT_HOSTED_APP_URL, ...request })
    : new URL("/settings/connections", DEFAULT_HOSTED_APP_URL).href;
}
