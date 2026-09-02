const DEFAULT_CLI_PROXY_API_URL = "https://cli-proxy-api-production-1615.up.railway.app/v1";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);

function containsControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export function resolveCliProxyApiUrl(raw = DEFAULT_CLI_PROXY_API_URL) {
  if (Buffer.byteLength(raw, "utf8") > 4096 || containsControlCharacter(raw)) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    const isLoopbackHttp = parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
    if (
      (parsed.protocol !== "https:" && !isLoopbackHttp) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return undefined;
    }
    return parsed.toString().replace(/\/+$/u, "");
  } catch {
    return undefined;
  }
}

export function redactCliProxyDiagnostic(value, sensitiveValues = []) {
  let redacted = String(value ?? "");
  for (const sensitive of sensitiveValues
    .filter((item) => typeof item === "string" && item.length >= 4)
    .toSorted((left, right) => right.length - left.length)) {
    redacted = redacted.replaceAll(sensitive, "***");
  }
  return redacted;
}

export function resolveCliProxyToken(raw) {
  const source = raw ?? "";
  if (!source || Buffer.byteLength(source, "utf8") > 8192 || containsControlCharacter(source)) {
    return undefined;
  }
  return source;
}
