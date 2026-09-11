const PRIVATE_LIFECYCLE_LINK_HOSTS = new Set(["expo-development-client", "expo-sharing"]);

/** Ignore only the exact native lifecycle hosts, not matching text inside a real app route. */
export function shouldHandleAppLink(url: string): boolean {
  try {
    return !PRIVATE_LIFECYCLE_LINK_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    // Preserve the previous fail-safe for malformed lifecycle input. React
    // Navigation owns any other malformed URL and will route it to NotFound.
    return !url.includes("expo-development-client") && !url.includes("://expo-sharing");
  }
}
