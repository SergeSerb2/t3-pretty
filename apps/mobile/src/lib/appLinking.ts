const PRIVATE_LIFECYCLE_LINK_HOSTS = new Set(["expo-development-client", "expo-sharing"]);
const APP_WAKE_ONLY_URL_PATTERN = /^t3code(-dev|-preview)?:\/*$/;

/**
 * The Expo dev client launches the app via
 * <scheme>://expo-development-client/?url=<packager> — that URL addresses
 * the launcher, not app navigation. Without this filter it falls through
 * to the NotFound wildcard route on every dev launch.
 * expo-sharing uses a private lifecycle URL only to wake the app. The
 * persisted share inbox in App.tsx owns navigation once the payload is durable.
 * A scheme-only URL, as sent by iOS dictation keyboards returning to the app,
 * only wakes the app and must not reset navigation to Home.
 * Lifecycle filtering uses exact hostnames so matching text inside a real app
 * route continues to reach React Navigation.
 */
export function shouldHandleAppLink(url: string): boolean {
  if (APP_WAKE_ONLY_URL_PATTERN.test(url)) return false;

  try {
    return !PRIVATE_LIFECYCLE_LINK_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    // Preserve the previous fail-safe for malformed lifecycle input. React
    // Navigation owns any other malformed URL and will route it to NotFound.
    return !url.includes("expo-development-client") && !url.includes("://expo-sharing");
  }
}
