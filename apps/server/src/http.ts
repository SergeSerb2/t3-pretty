import Mime from "@effect/platform-node/Mime";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
} from "@t3tools/contracts";
import { isDevProxiedPath } from "@t3tools/shared/devProxy";
import { decodeOtlpTraceRecords } from "@t3tools/shared/observability";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { cast } from "effect/Function";
import {
  HttpBody,
  HttpClient,
  HttpClientResponse,
  HttpMiddleware,
  HttpRouter,
  HttpServerError,
  HttpServerResponse,
  HttpServerRequest,
  HttpServerRespondable,
} from "effect/unstable/http";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { OtlpTracer } from "effect/unstable/observability";

import * as ServerConfig from "./config.ts";
import {
  ASSET_ROUTE_PREFIX,
  resolveAsset,
  type ResolvedAssetSource,
} from "./assets/AssetAccess.ts";
import { ATTACHMENT_FEED_PREVIEW_VARIANT } from "./assets/attachmentFeedPreviewPath.ts";
import { resolveAttachmentFeedPreview } from "./assets/AttachmentPreview.ts";
import * as BrowserTraceCollector from "./observability/BrowserTraceCollector.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import { traceRelayRequest } from "./cloud/traceRelayRequest.ts";
import {
  annotateEnvironmentRequest,
  failEnvironmentScopeRequired,
  failEnvironmentAuthInvalid,
  failEnvironmentInternal,
  requireEnvironmentScope,
} from "./auth/http.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import { browserApiCorsAllowedHeaders, browserApiCorsAllowedMethods } from "./httpCors.ts";
import { loadServerConfigSnapshot } from "./serverConfigSnapshot.ts";
import { releaseHttpClientResponseBody } from "./stream/releaseHttpClientResponseBody.ts";

const OTLP_TRACES_PROXY_PATH = "/api/observability/v1/traces";
const OTLP_TRACES_MAX_BODY_BYTES = 4 * 1024 * 1024;
const OTLP_TRACES_EXPORT_TIMEOUT = "10 seconds";
const decodeUnknownJsonString = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "::1", "localhost"]);
const DESKTOP_RENDERER_ORIGINS = ["t3code://app", "t3code-dev://app"];
const SVG_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export function assetResponseHeaders(
  filePath: string,
  source?: ResolvedAssetSource,
): Record<string, string> {
  const lowerPath = filePath.toLowerCase();
  return {
    // Attachment bytes never change for a given attachment id, so they can be
    // cached hard; workspace files and favicons can be edited in place.
    "Cache-Control":
      source === "attachment" ? "private, max-age=31536000, immutable" : "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    // Asset URLs are signed capability URLs (the token is the whole
    // authorization), so cross-origin reads — the desktop renderer origin
    // included — are safe to allow for any origin.
    ...(source === "attachment" || source === "workspace-file" || source === "generated-image"
      ? { "Access-Control-Allow-Origin": "*" }
      : {}),
    ...(lowerPath.endsWith(".html") || lowerPath.endsWith(".htm")
      ? { "Content-Type": "text/html; charset=utf-8" }
      : {}),
    ...(lowerPath.endsWith(".svg")
      ? { "Content-Security-Policy": SVG_CONTENT_SECURITY_POLICY }
      : {}),
  };
}

export const httpCompressionLayer = HttpRouter.middleware(HttpMiddleware.compression(), {
  global: true,
});

export const browserApiCorsLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const devOrigin = config.devUrl?.origin;
    // Dev uses credentialed requests from Vite or the Electron custom origin, so both must be
    // explicit. Packaged desktop omits credentials and uses Effect's default wildcard origin.
    //
    // T3CODE_DEV_ALLOWED_ORIGINS covers dev servers reached from a second
    // origin — a tailnet name, a LAN IP, a phone. Browser dev normally proxies
    // through Vite and is same-origin (no preflight at all), so this is a
    // safety net for the desktop renderer and any direct-to-backend caller.
    return HttpRouter.cors({
      ...(devOrigin
        ? {
            allowedOrigins: [devOrigin, ...DESKTOP_RENDERER_ORIGINS, ...config.devAllowedOrigins],
            credentials: true,
          }
        : {}),
      allowedMethods: browserApiCorsAllowedMethods,
      allowedHeaders: browserApiCorsAllowedHeaders,
      maxAge: 600,
    });
  }),
);

export function isLoopbackHostname(hostname: string): boolean {
  const normalizedHostname = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  return LOOPBACK_HOSTNAMES.has(normalizedHostname);
}

const HASHED_CLIENT_ASSET_PATH = /^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

export function isHashedClientAssetPath(relativePath: string): boolean {
  return HASHED_CLIENT_ASSET_PATH.test(relativePath.replaceAll("\\", "/"));
}

export function staticClientAssetCacheControl(relativePath: string): string {
  return isHashedClientAssetPath(relativePath) ? "public, max-age=31536000, immutable" : "no-cache";
}

export function acceptsBrotliEncoding(acceptEncoding: string | undefined): boolean {
  if (!acceptEncoding) return false;
  return acceptEncoding.split(",").some((part) => {
    const token = part.trim().split(";")[0]?.trim().toLowerCase();
    return token === "br";
  });
}

export function shouldEnablePermessageDeflate(input: {
  readonly remoteAddress?: string | null | undefined;
  readonly origin?: string | null | undefined;
}): boolean {
  const origin = input.origin?.trim() ?? "";
  if (origin.startsWith("t3code://") || origin.startsWith("t3code-dev://")) {
    return false;
  }
  if (origin.startsWith("http://") || origin.startsWith("https://")) {
    try {
      const host = new URL(origin).hostname;
      if (!isLoopbackHostname(host)) return true;
    } catch {
      // Fall through to the socket address.
    }
  }
  const address = (input.remoteAddress ?? "").replace(/^::ffff:/, "").replace(/^\[|\]$/g, "");
  return address.length > 0 && !isLoopbackHostname(address);
}

export function stripPermessageDeflateExtensionOffer(
  extensionsHeader: string | undefined,
): string | undefined {
  if (!extensionsHeader) return undefined;
  const next = extensionsHeader
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.toLowerCase().startsWith("permessage-deflate"))
    .join(", ");
  return next.length > 0 ? next : undefined;
}

export function resolveDevRedirectUrl(devUrl: URL, requestUrl: URL): string {
  const redirectUrl = new URL(devUrl.toString());
  redirectUrl.pathname = requestUrl.pathname;
  redirectUrl.search = requestUrl.search;
  redirectUrl.hash = requestUrl.hash;
  return redirectUrl.toString();
}

const authenticateRawRouteWithScope = (
  scope: typeof AuthOrchestrationReadScope | typeof AuthOrchestrationOperateScope,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const serverAuth = yield* EnvironmentAuth.EnvironmentAuth;
    const session = yield* serverAuth.authenticateHttpRequest(request).pipe(
      Effect.catchIf(EnvironmentAuth.isServerAuthCredentialError, (error) =>
        failEnvironmentAuthInvalid(EnvironmentAuth.serverAuthCredentialReason(error)),
      ),
      Effect.catchIf(EnvironmentAuth.isServerAuthInternalError, (error) =>
        failEnvironmentInternal("internal_error", error),
      ),
    );
    if (!session.scopes.includes(scope)) {
      return yield* failEnvironmentScopeRequired(scope);
    }
  });

export const serverEnvironmentHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "metadata",
  Effect.fnUntraced(function* (handlers) {
    const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
    return handlers.handle(
      "descriptor",
      Effect.fn("environment.metadata.descriptor")(function* (args) {
        yield* annotateEnvironmentRequest(args.endpoint.name);
        return yield* serverEnvironment.getDescriptor;
      }, traceRelayRequest),
    );
  }),
);

export const serverConfigHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "server",
  Effect.fnUntraced(function* (handlers) {
    return yield* Effect.succeed(
      handlers.handle(
        "config",
        Effect.fn("environment.server.config")(function* (args) {
          yield* annotateEnvironmentRequest(args.endpoint.name);
          yield* requireEnvironmentScope(AuthOrchestrationReadScope);
          return yield* loadServerConfigSnapshot.pipe(
            Effect.tap((snapshot) =>
              Effect.annotateCurrentSpan({
                "server.config.decodedBytes": JSON.stringify(snapshot.config).length,
                "server.config.transport": "http",
              }),
            ),
            Effect.catch((error) => failEnvironmentInternal("server_config_failed", error)),
          );
        }, traceRelayRequest),
      ),
    );
  }),
);

class DecodeOtlpTraceRecordsError extends Data.TaggedError("DecodeOtlpTraceRecordsError")<{
  readonly cause: unknown;
}> {}

export class RequestBodySizeLimitExceededError extends Data.TaggedError(
  "RequestBodySizeLimitExceededError",
)<{
  readonly maxBytes: number;
  readonly observedBytes: number;
}> {}

export function readJsonBodyWithinByteLimit<E, R>(
  stream: Stream.Stream<Uint8Array, E, R>,
  maxBytes: number,
): Effect.Effect<unknown, E | RequestBodySizeLimitExceededError | Schema.SchemaError, R> {
  return Effect.gen(function* () {
    const body = yield* stream.pipe(
      Stream.runFoldEffect(
        () => ({ chunks: [] as Array<Uint8Array<ArrayBufferLike>>, bytes: 0 }),
        (state, chunk) => {
          const observedBytes = state.bytes + chunk.byteLength;
          if (observedBytes > maxBytes) {
            return Effect.fail(new RequestBodySizeLimitExceededError({ maxBytes, observedBytes }));
          }
          state.chunks.push(chunk);
          return Effect.succeed({ chunks: state.chunks, bytes: observedBytes });
        },
      ),
    );
    const text = Buffer.concat(body.chunks, body.bytes).toString("utf8");
    return yield* decodeUnknownJsonString(text);
  });
}

export const otlpTracesProxyRouteLayer = HttpRouter.add(
  "POST",
  OTLP_TRACES_PROXY_PATH,
  Effect.gen(function* () {
    yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
    const request = yield* HttpServerRequest.HttpServerRequest;
    const config = yield* ServerConfig.ServerConfig;
    const otlpTracesUrl = config.otlpTracesUrl;
    const browserTraceCollector = yield* BrowserTraceCollector.BrowserTraceCollector;
    const httpClient = yield* HttpClient.HttpClient;
    const rawBodyJson = yield* readJsonBodyWithinByteLimit(
      request.stream,
      OTLP_TRACES_MAX_BODY_BYTES,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new HttpServerError.HttpServerError({
            reason: new HttpServerError.RequestParseError({
              request,
              cause,
              ...(cause instanceof RequestBodySizeLimitExceededError
                ? { description: `request body exceeded ${cause.maxBytes} bytes` }
                : {}),
            }),
          }),
      ),
    );
    const resourceSpanCount =
      typeof rawBodyJson === "object" &&
      rawBodyJson !== null &&
      "resourceSpans" in rawBodyJson &&
      Array.isArray(rawBodyJson.resourceSpans)
        ? rawBodyJson.resourceSpans.length
        : null;
    const bodyJson = cast<unknown, OtlpTracer.TraceData>(rawBodyJson);

    yield* Effect.try({
      try: () => decodeOtlpTraceRecords(bodyJson),
      catch: (cause) => new DecodeOtlpTraceRecordsError({ cause }),
    }).pipe(
      Effect.flatMap((records) => browserTraceCollector.record(records)),
      Effect.catch((cause) =>
        Effect.logWarning("Failed to decode browser OTLP traces", {
          cause,
          resourceSpanCount,
        }),
      ),
    );

    if (otlpTracesUrl === undefined) {
      return HttpServerResponse.empty({ status: 204 });
    }

    return yield* httpClient
      .post(otlpTracesUrl, {
        body: HttpBody.jsonUnsafe(bodyJson),
      })
      .pipe(
        Effect.flatMap((response) =>
          releaseHttpClientResponseBody(response).pipe(
            Effect.andThen(HttpClientResponse.filterStatusOk(response)),
          ),
        ),
        Effect.timeout(OTLP_TRACES_EXPORT_TIMEOUT),
        Effect.as(HttpServerResponse.empty({ status: 204 })),
        Effect.tapError((cause) =>
          Effect.logWarning("Failed to export browser OTLP traces", {
            cause,
            otlpTracesUrl,
          }),
        ),
        Effect.orElseSucceed(() =>
          HttpServerResponse.text("Trace export failed.", { status: 502 }),
        ),
      );
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
    }),
  ),
);

export const assetRouteLayer = HttpRouter.add(
  "GET",
  `${ASSET_ROUTE_PREFIX}/*`,
  HttpMiddleware.withLoggerDisabled(
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const url = HttpServerRequest.toURL(request);
      if (Option.isNone(url)) {
        return HttpServerResponse.text("Bad Request", { status: 400 });
      }

      const suffix = url.value.pathname.slice(`${ASSET_ROUTE_PREFIX}/`.length);
      const separatorIndex = suffix.indexOf("/");
      if (separatorIndex <= 0) {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }

      const asset = yield* resolveAsset(
        suffix.slice(0, separatorIndex),
        suffix.slice(separatorIndex + 1),
      );
      if (!asset) {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
      const config = yield* ServerConfig.ServerConfig;
      const requestedPath =
        asset.source === "attachment" &&
        asset.attachmentId !== undefined &&
        url.value.searchParams.get("variant") === ATTACHMENT_FEED_PREVIEW_VARIANT
          ? yield* resolveAttachmentFeedPreview({
              attachmentsDir: config.attachmentsDir,
              attachmentId: asset.attachmentId,
              sourcePath: asset.path,
            })
          : asset.path;
      return yield* HttpServerResponse.file(requestedPath, {
        status: 200,
        headers: assetResponseHeaders(requestedPath, asset.source),
      }).pipe(
        Effect.orElseSucceed(() =>
          HttpServerResponse.text("Internal Server Error", { status: 500 }),
        ),
      );
    }),
  ),
);

export const staticAndDevRouteLayer = HttpRouter.add(
  "GET",
  "*",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);

    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const config = yield* ServerConfig.ServerConfig;
    if (config.devUrl && isDevProxiedPath(url.value.pathname)) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    if (config.devUrl && isLoopbackHostname(url.value.hostname)) {
      return HttpServerResponse.redirect(resolveDevRedirectUrl(config.devUrl, url.value), {
        status: 302,
      });
    }

    const staticDir =
      config.staticDir ?? (config.devUrl ? yield* ServerConfig.resolveStaticDir() : undefined);
    if (!staticDir) {
      return HttpServerResponse.text("No static directory configured and no dev URL set.", {
        status: 503,
      });
    }

    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const staticRoot = path.resolve(staticDir);
    const staticRequestPath = url.value.pathname === "/" ? "/index.html" : url.value.pathname;
    const rawStaticRelativePath = staticRequestPath.replace(/^[/\\]+/, "");
    const hasRawLeadingParentSegment = rawStaticRelativePath.startsWith("..");
    const staticRelativePath = path.normalize(rawStaticRelativePath).replace(/^[/\\]+/, "");
    const hasPathTraversalSegment = staticRelativePath.startsWith("..");
    if (
      staticRelativePath.length === 0 ||
      hasRawLeadingParentSegment ||
      hasPathTraversalSegment ||
      staticRelativePath.includes("\0")
    ) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const isWithinStaticRoot = (candidate: string) =>
      candidate === staticRoot ||
      candidate.startsWith(staticRoot.endsWith(path.sep) ? staticRoot : `${staticRoot}${path.sep}`);

    let filePath = path.resolve(staticRoot, staticRelativePath);
    if (!isWithinStaticRoot(filePath)) {
      return HttpServerResponse.text("Invalid static file path", { status: 400 });
    }

    const ext = path.extname(filePath);
    if (!ext) {
      filePath = path.resolve(filePath, "index.html");
      if (!isWithinStaticRoot(filePath)) {
        return HttpServerResponse.text("Invalid static file path", { status: 400 });
      }
    }

    const fileInfo = yield* fileSystem.stat(filePath).pipe(Effect.orElseSucceed(() => null));
    if (!fileInfo || fileInfo.type !== "File") {
      const indexPath = path.resolve(staticRoot, "index.html");
      return yield* HttpServerResponse.file(indexPath, {
        status: 200,
        headers: {
          "Cache-Control": "no-cache",
          "Content-Type": "text/html; charset=utf-8",
        },
      }).pipe(Effect.orElseSucceed(() => HttpServerResponse.text("Not Found", { status: 404 })));
    }

    const contentType = Mime.getType(filePath) ?? "application/octet-stream";
    const acceptEncodingHeader = request.headers["accept-encoding"];
    const acceptEncoding = Array.isArray(acceptEncodingHeader)
      ? acceptEncodingHeader.join(",")
      : acceptEncodingHeader;
    const cacheControl = staticClientAssetCacheControl(staticRelativePath);
    if (acceptsBrotliEncoding(acceptEncoding)) {
      const brotliPath = `${filePath}.br`;
      const brotliResponse = yield* HttpServerResponse.file(brotliPath, {
        status: 200,
        headers: {
          "Cache-Control": cacheControl,
          "Content-Encoding": "br",
          "Content-Type": contentType,
          Vary: "Accept-Encoding",
        },
      }).pipe(Effect.orElseSucceed(() => null));
      if (brotliResponse) {
        return brotliResponse;
      }
    }

    return yield* HttpServerResponse.file(filePath, {
      status: 200,
      headers: {
        "Cache-Control": cacheControl,
        "Content-Type": contentType,
      },
    }).pipe(
      Effect.orElseSucceed(() => HttpServerResponse.text("Internal Server Error", { status: 500 })),
    );
  }),
);
