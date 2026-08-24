import { DEFAULT_HOSTED_APP_URL, hostedAppRouteUrl } from "@t3tools/shared/connectAuth";
import {
  readHostedPairingRequest as readSharedHostedPairingRequest,
  type HostedPairingRequest as SharedHostedPairingRequest,
} from "@t3tools/shared/remote";

import { setPairingTokenOnUrl } from "./pairingUrl";

export type HostedPairingRequest = SharedHostedPairingRequest;

export type HostedAppChannel = "latest" | "nightly";

export function configuredHostedAppUrl(): string {
  return import.meta.env.VITE_HOSTED_APP_URL?.trim() || DEFAULT_HOSTED_APP_URL;
}

function configuredBackendUrl(): string {
  return import.meta.env.VITE_HTTP_URL?.trim() || import.meta.env.VITE_WS_URL?.trim() || "";
}

function configuredHostedAppChannel(): HostedAppChannel | null {
  const channel = import.meta.env.VITE_HOSTED_APP_CHANNEL?.trim().toLowerCase();
  return channel === "latest" || channel === "nightly" ? channel : null;
}

function originFromUrl(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isHostedStaticApp(url: URL = new URL(window.location.href)): boolean {
  if (configuredBackendUrl()) {
    return false;
  }

  if (configuredHostedAppChannel()) {
    return true;
  }

  const hostedOrigin = originFromUrl(configuredHostedAppUrl());
  return hostedOrigin !== null && url.origin === hostedOrigin;
}

export function readHostedPairingRequest(
  url: URL = new URL(window.location.href),
): HostedPairingRequest | null {
  return readSharedHostedPairingRequest(url);
}

export function hasHostedPairingRequest(url: URL = new URL(window.location.href)): boolean {
  return readHostedPairingRequest(url) !== null;
}

export function buildHostedPairingUrl(input: {
  readonly host: string;
  readonly token: string;
  readonly label?: string | null;
}): string {
  const url = hostedAppRouteUrl(configuredHostedAppUrl(), "/pair");
  url.searchParams.set("host", input.host);

  const label = input.label?.trim();
  if (label) {
    url.searchParams.set("label", label);
  }

  return setPairingTokenOnUrl(url, input.token).toString();
}

export function buildHostedChannelSelectionUrl(input: {
  readonly channel: HostedAppChannel;
}): string {
  const url = hostedAppRouteUrl(configuredHostedAppUrl(), "/__t3code/channel");
  url.searchParams.set("channel", input.channel);
  return url.toString();
}
