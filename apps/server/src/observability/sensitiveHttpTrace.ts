const SENSITIVE_ASSET_PATH_PREFIX = "/api/assets/";

/** Routes whose URL itself carries a signed capability that must not reach tracing sinks. */
export function shouldDisableHttpServerTracing(rawUrl: string): boolean {
  let pathname: string;
  try {
    pathname = new URL(rawUrl, "http://t3.invalid").pathname;
  } catch {
    pathname = rawUrl.split(/[?#]/, 1)[0] ?? rawUrl;
  }
  return (
    pathname === "/ws" ||
    pathname === SENSITIVE_ASSET_PATH_PREFIX.slice(0, -1) ||
    pathname.startsWith(SENSITIVE_ASSET_PATH_PREFIX)
  );
}
