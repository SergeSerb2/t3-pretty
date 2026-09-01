// @effect-diagnostics nodeBuiltinImport:off - protocol handlers run as plain async callbacks outside the Effect runtime, so file paths are resolved with node:path directly.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodePath from "node:path";
import * as NodeTimersPromises from "node:timers/promises";
import * as NodeURL from "node:url";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

export const DESKTOP_HOST = "app";
export const DESKTOP_PRODUCTION_SCHEME = "t3code";
export const DESKTOP_DEVELOPMENT_SCHEME = "t3code-dev";

export function getDesktopScheme(isDevelopment: boolean): string {
  return isDevelopment ? DESKTOP_DEVELOPMENT_SCHEME : DESKTOP_PRODUCTION_SCHEME;
}

export function getDesktopOrigin(isDevelopment: boolean): string {
  return `${getDesktopScheme(isDevelopment)}://${DESKTOP_HOST}`;
}

export function getDesktopUrl(isDevelopment: boolean): string {
  return `${getDesktopOrigin(isDevelopment)}/`;
}

export class ElectronProtocolRegistrationError extends Schema.TaggedErrorClass<ElectronProtocolRegistrationError>()(
  "ElectronProtocolRegistrationError",
  {
    scheme: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to register Electron protocol scheme "${this.scheme}".`;
  }
}

export class ElectronProtocolUnregistrationError extends Schema.TaggedErrorClass<ElectronProtocolUnregistrationError>()(
  "ElectronProtocolUnregistrationError",
  {
    scheme: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to unregister Electron protocol scheme "${this.scheme}".`;
  }
}

export interface DesktopProtocolRegistrationInput {
  readonly scheme: string;
  readonly targetOrigin: URL;
  readonly backendOrigin: URL;
  readonly clerkFrontendApiHostname: string | undefined;
  // Built renderer on disk (apps/server/dist/client). When set, documents and
  // assets are read straight from disk so the window can load before the
  // backend listens; only API paths are proxied to targetOrigin. Undefined in
  // development, where the Vite dev server serves everything.
  readonly clientDistDir: string | undefined;
}

export class ElectronProtocol extends Context.Service<
  ElectronProtocol,
  {
    readonly registerDesktopProtocol: (
      input: DesktopProtocolRegistrationInput,
    ) => Effect.Effect<void, ElectronProtocolRegistrationError, Scope.Scope>;
  }
>()("@t3tools/desktop/electron/ElectronProtocol") {}

export function makeDesktopContentSecurityPolicy(input: DesktopProtocolRegistrationInput): string {
  const clerkOrigin = input.clerkFrontendApiHostname
    ? `https://${input.clerkFrontendApiHostname}`
    : undefined;
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    ...(clerkOrigin ? [clerkOrigin] : []),
    "https://challenges.cloudflare.com",
  ];

  // The renderer connects directly to user-configured environments in addition to
  // the build-configured Clerk, relay, and OTLP endpoints. Those environment
  // origins are not known when this response policy is created, so restrict
  // connections by the network schemes the client supports instead of by host.
  const connectSources = ["'self'", "http:", "https:", "ws:", "wss:"];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    `img-src 'self' ${input.scheme}: blob: data: http: https:`,
    `media-src 'self' ${input.scheme}: blob:`,
    "style-src 'self' 'unsafe-inline'",
    `font-src 'self' ${input.scheme}: data:`,
    "worker-src 'self' blob:",
    "frame-src 'self' https://challenges.cloudflare.com",
    "form-action 'self'",
  ].join("; ");
}

function withContentSecurityPolicy(
  response: Response,
  policy: string,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", policy);
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Same-origin paths the renderer may still address relatively; everything else
// under t3code://app is the SPA and comes from disk.
const PROXIED_PATH_PREFIXES = ["/api/", "/oauth/", "/.well-known/"] as const;

export function isProxiedRendererPath(pathname: string): boolean {
  return PROXIED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Mirrors the server's hashed-asset rule (apps/server/src/http.ts) so the V8
// code cache and HTTP cache treat disk-served assets the same way.
const HASHED_CLIENT_ASSET_PATH = /^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

export function clientAssetCacheControl(relativePath: string): string {
  return HASHED_CLIENT_ASSET_PATH.test(relativePath.replaceAll("\\", "/"))
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

/**
 * Map a t3code://app pathname to a file below the client dist. Extension-less
 * paths are SPA routes and resolve to index.html; anything escaping the root
 * resolves to null.
 */
export function resolveClientDistFile(clientDistDir: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relativePath = decoded.replace(/^\/+/, "");
  const candidate =
    relativePath.length === 0 || NodePath.extname(relativePath) === ""
      ? "index.html"
      : relativePath;
  const root = NodePath.resolve(clientDistDir);
  const resolved = NodePath.resolve(root, candidate);
  if (resolved !== root && !resolved.startsWith(root + NodePath.sep)) {
    return null;
  }
  return resolved;
}

async function serveClientDistFile(
  clientDistDir: string,
  pathname: string,
  contentSecurityPolicy: string,
): Promise<Response> {
  const filePath = resolveClientDistFile(clientDistDir, pathname);
  if (filePath === null) {
    return new Response(null, { status: 404 });
  }
  const indexPath = NodePath.join(clientDistDir, "index.html");
  const fetchFile = async (target: string) => {
    try {
      const response = await Electron.net.fetch(NodeURL.pathToFileURL(target).toString());
      return response.ok ? response : null;
    } catch {
      return null;
    }
  };
  // Like the server: an unknown file falls back to the SPA shell (a route
  // segment with a dot, e.g. an ssh host). Hashed asset misses must not be
  // cached as immutable HTML, so the header follows the file actually served.
  let servedPath = filePath;
  let served = await fetchFile(filePath);
  if (served === null && filePath !== indexPath) {
    servedPath = indexPath;
    served = await fetchFile(indexPath);
  }
  if (served === null) {
    return new Response(null, { status: 404 });
  }
  const relativePath = NodePath.relative(clientDistDir, servedPath);
  return withContentSecurityPolicy(served, contentSecurityPolicy, {
    "Cache-Control": clientAssetCacheControl(relativePath),
  });
}

async function handleRendererRequest(
  request: Request,
  input: DesktopProtocolRegistrationInput,
  contentSecurityPolicy: string,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  if (requestUrl.host !== DESKTOP_HOST) {
    return new Response(null, { status: 404 });
  }
  const isRead = request.method === "GET" || request.method === "HEAD";
  if (input.clientDistDir === undefined || !isRead || isProxiedRendererPath(requestUrl.pathname)) {
    return proxyRequest(request, input.targetOrigin, contentSecurityPolicy);
  }
  return serveClientDistFile(input.clientDistDir, requestUrl.pathname, contentSecurityPolicy);
}

/**
 * Must run synchronously during process bootstrap, before Electron emits `ready`.
 */
export function registerDesktopSchemePrivilegesSync(): void {
  Electron.protocol.registerSchemesAsPrivileged([
    {
      scheme: DESKTOP_PRODUCTION_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        codeCache: true,
      },
    },
    {
      scheme: DESKTOP_DEVELOPMENT_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        codeCache: true,
      },
    },
  ]);
}

const registerDesktopSchemePrivileges = Effect.sync(registerDesktopSchemePrivilegesSync).pipe(
  Effect.withSpan("desktop.electron.protocol.registerSchemePrivileges"),
);

export const layerSchemePrivileges = Layer.effectDiscard(registerDesktopSchemePrivileges);

async function proxyRequest(
  request: Request,
  targetOrigin: URL,
  contentSecurityPolicy: string,
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const targetUrl = resolveProxyTargetUrl(requestUrl, targetOrigin);
  const headers = new Headers(request.headers);
  const headersToRemove: string[] = [];
  for (const name of headers.keys()) {
    if (
      name === "host" ||
      name === "origin" ||
      name === "referer" ||
      name === "connection" ||
      name === "content-length" ||
      name === "accept-encoding" ||
      name === "upgrade-insecure-requests" ||
      name.startsWith("sec-fetch-")
    ) {
      headersToRemove.push(name);
    }
  }
  for (const name of headersToRemove) {
    headers.delete(name);
  }
  const init: RequestInit = {
    method: request.method,
    headers,
    signal: request.signal,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    (init as RequestInit & { duplex: "half" }).duplex = "half";
  }
  const response =
    request.method === "GET" || request.method === "HEAD"
      ? await fetchWithTransientRetry(targetUrl.toString(), init)
      : await Electron.net.fetch(targetUrl.toString(), init);
  return withContentSecurityPolicy(response, contentSecurityPolicy);
}

export function resolveProxyTargetUrl(requestUrl: URL, targetOrigin: URL): URL {
  const targetUrl = new URL(targetOrigin);
  // Assign URL components rather than resolving a path-shaped string. A
  // renderer path beginning with `//` is a network-path reference to the URL
  // constructor and would otherwise replace the configured backend host.
  targetUrl.pathname = requestUrl.pathname;
  targetUrl.search = requestUrl.search;
  targetUrl.hash = "";
  return targetUrl;
}

const TRANSIENT_FETCH_RETRY_DELAYS_MS = [0, 50, 150] as const;

async function fetchWithTransientRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (const delayMs of TRANSIENT_FETCH_RETRY_DELAYS_MS) {
    init.signal?.throwIfAborted();
    if (delayMs > 0) {
      await NodeTimersPromises.setTimeout(delayMs);
    }

    try {
      return await Electron.net.fetch(url, init);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      lastError = error;
    }
  }

  throw lastError;
}

export const make = Effect.gen(function* () {
  const registered = yield* Ref.make(false);

  const registerDesktopProtocol = Effect.fn("desktop.electron.protocol.registerDesktopProtocol")(
    function* (input: DesktopProtocolRegistrationInput) {
      if (yield* Ref.get(registered)) return;

      const contentSecurityPolicy = makeDesktopContentSecurityPolicy(input);

      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            Electron.protocol.handle(input.scheme, (request) =>
              handleRendererRequest(request, input, contentSecurityPolicy),
            );
          },
          catch: (cause) => new ElectronProtocolRegistrationError({ scheme: input.scheme, cause }),
        }).pipe(Effect.andThen(Ref.set(registered, true))),
        () =>
          Effect.try({
            try: () => Electron.protocol.unhandle(input.scheme),
            catch: (cause) =>
              new ElectronProtocolUnregistrationError({
                scheme: input.scheme,
                cause,
              }),
          }).pipe(Effect.andThen(Ref.set(registered, false)), Effect.orDie),
      );
    },
  );

  return ElectronProtocol.of({ registerDesktopProtocol });
});

export const layer = Layer.effect(ElectronProtocol, make);
