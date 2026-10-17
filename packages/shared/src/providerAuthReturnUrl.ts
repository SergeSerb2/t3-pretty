import { isLoopbackHost } from "./preview.ts";

/** Only return to a local client or the hosted T3 client, never an arbitrary OAuth-supplied URL. */
export function providerAuthReturnUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const desktop = ["t3code:", "t3code-dev:"].includes(url.protocol) && url.host === "app";
    if (desktop && url.pathname === "/" && url.hash.startsWith("#/")) {
      const route = new URL(url.hash.slice(1), url);
      if (
        route.protocol !== url.protocol ||
        route.host !== url.host ||
        route.username ||
        route.password
      )
        return undefined;
      url.pathname = route.pathname;
      url.search = route.search;
      url.hash = route.hash;
    }
    const web =
      ["http:", "https:"].includes(url.protocol) &&
      (isLoopbackHost(url.hostname) || url.origin === "https://app.t3.codes");
    if (
      url.username ||
      url.password ||
      (!desktop && !web) ||
      (url.pathname !== "/welcome" &&
        url.pathname !== "/settings" &&
        !url.pathname.startsWith("/settings/"))
    )
      return undefined;
    for (const key of Array.from(url.searchParams.keys())) {
      if (
        url.pathname === "/welcome" ||
        !["machine", "project", "checkout", "environmentId", "instanceId"].includes(key)
      ) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname !== "/welcome" || !/^#agents:[\w-]+$/u.test(url.hash)) url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Desktop uses hash history; hosted and local browser clients use path history. */
export function providerAuthNavigationUrl(value: string | undefined): string | undefined {
  const destination = providerAuthReturnUrl(value);
  if (!destination) return undefined;
  const url = new URL(destination);
  return ["t3code:", "t3code-dev:"].includes(url.protocol)
    ? `${url.protocol}//${url.host}/#${url.pathname}${url.search}${url.hash}`
    : destination;
}
