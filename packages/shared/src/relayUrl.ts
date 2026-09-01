import { SECURE_RELAY_URL_MAX_LENGTH } from "@t3tools/contracts/relay";

export { SECURE_RELAY_URL_MAX_LENGTH };

export function normalizeSecureRelayUrl(value: string): string | null {
  if (value.length === 0 || value.length > SECURE_RELAY_URL_MAX_LENGTH) {
    return null;
  }
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0 ||
      !/^\/+$/u.test(url.pathname)
    ) {
      return null;
    }
    return url.origin.length <= SECURE_RELAY_URL_MAX_LENGTH ? url.origin : null;
  } catch {
    return null;
  }
}

export function isSecureRelayUrl(value: string): boolean {
  return normalizeSecureRelayUrl(value) !== null;
}
