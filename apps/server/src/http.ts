import Mime from "@effect/platform-node/Mime";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  PROJECT_TRANSFER_MAX_ARCHIVE_BYTES,
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
import { statMediaFile, streamMediaFile, type OpenMediaFile } from "./assets/MediaFile.ts";
import {
  ATTACHMENT_UPLOAD_ROUTE_PREFIX,
  storeAttachmentUpload,
  validateAttachmentUploadToken,
} from "./assets/AttachmentUpload.ts";
import {
  PROJECT_TRANSFER_UPLOAD_ROUTE_PREFIX,
  receiveProjectTransfer,
  validateProjectTransferUploadToken,
} from "./project/ProjectTransfer.ts";
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
// HTML previews are agent output, not the app. The sandbox gives the document an
// opaque origin: scripts run, but same-origin cookies, storage, and API calls are
// out of reach. Relative sibling assets still load through their signed URLs.
const HTML_CONTENT_SECURITY_POLICY = "sandbox allow-scripts allow-forms allow-popups allow-modals";

// Types a browser may render as a document if a proxy strips the disposition
// header. Downloads of these fall back to octet-stream.
const DOWNLOAD_MIME_TYPE_PATTERN = /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/;
const isSafeDownloadMimeType = (mimeType: string): boolean =>
  DOWNLOAD_MIME_TYPE_PATTERN.test(mimeType) &&
  !/(?:^text\/html$|\/xml(?:$|-)|\+xml$)/i.test(mimeType.trim().toLowerCase());
const isSafeInlineVideoMimeType = (mimeType: string): boolean =>
  DOWNLOAD_MIME_TYPE_PATTERN.test(mimeType) && mimeType.toLowerCase().startsWith("video/");
const isSafeInlineDocumentMimeType = (mimeType: string): boolean =>
  mimeType.toLowerCase() === "application/pdf" || mimeType.toLowerCase() === "text/html";

/** RFC 6266 disposition with an ASCII fallback name plus a UTF-8 `filename*`. */
export function downloadContentDisposition(fileName?: string): string {
  if (fileName === undefined) {
    return "attachment";
  }
  // toWellFormed: encodeURIComponent throws URIError on unpaired surrogates.
  const sanitized = fileName.toWellFormed().replace(/[\p{Cc}"\\]/gu, "_");
  const asciiFallback = sanitized.replace(/[^\u0020-\u007e]/g, "_");
  const needsExtended = asciiFallback !== sanitized;
  const extendedName = encodeURIComponent(sanitized).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${asciiFallback}"${
    needsExtended ? `; filename*=UTF-8''${extendedName}` : ""
  }`;
}

type AssetResponseHeadersOptions = {
  readonly source?: ResolvedAssetSource;
  readonly download?: boolean;
  readonly fileName?: string;
  readonly mimeType?: string;
};

export function assetResponseHeaders(
  filePath: string,
  sourceOrOptions?: ResolvedAssetSource | AssetResponseHeadersOptions,
): Record<string, string> {
  const options = typeof sourceOrOptions === "string" ? undefined : sourceOrOptions;
  const source = typeof sourceOrOptions === "string" ? sourceOrOptions : sourceOrOptions?.source;
  const lowerPath = filePath.toLowerCase();
  const inlineMimeType = options?.mimeType?.split(";", 1)[0]?.trim();
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
    ...(options?.download
      ? {
          "Content-Disposition": downloadContentDisposition(options.fileName),
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Content-Type":
            options.mimeType !== undefined && isSafeDownloadMimeType(options.mimeType)
              ? options.mimeType
              : "application/octet-stream",
        }
      : inlineMimeType !== undefined && isSafeInlineVideoMimeType(inlineMimeType)
        ? { "Content-Type": inlineMimeType }
        : inlineMimeType !== undefined && isSafeInlineDocumentMimeType(inlineMimeType)
          ? {
              "Content-Type":
                inlineMimeType.toLowerCase() === "text/html"
                  ? "text/html; charset=utf-8"
                  : "application/pdf",
              ...(inlineMimeType.toLowerCase() === "text/html"
                ? { "Content-Security-Policy": HTML_CONTENT_SECURITY_POLICY }
                : {}),
            }
          : lowerPath.endsWith(".html") || lowerPath.endsWith(".htm")
            ? {
                "Content-Type": "text/html; charset=utf-8",
                "Content-Security-Policy": HTML_CONTENT_SECURITY_POLICY,
              }
            : {}),
    ...(!options?.download && lowerPath.endsWith(".svg")
      ? { "Content-Security-Policy": SVG_CONTENT_SECURITY_POLICY }
      : {}),
  };
}

/** A single byte range for native video readers; unsupported range syntax uses the full file. */
function assetByteRange(header: string, size: bigint) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (!match[1] && !match[2])) return null;
  const first = match[1] ? BigInt(match[1]) : null;
  const last = match[2] ? BigInt(match[2]) : null;
  if (first !== null && last !== null && last < first) return null;
  if (size === 0n || (first !== null && first >= size) || (first === null && last === 0n)) {
    return { _tag: "Unsatisfiable" as const };
  }
  const start = first ?? (last! >= size ? 0n : size - last!);
  const end = first === null || last === null || last >= size ? size - 1n : last;
  if (!Number.isSafeInteger(Number(start)) || !Number.isSafeInteger(Number(end))) {
    return { _tag: "Unsatisfiable" as const };
  }
  return {
    _tag: "Range" as const,
    offset: start,
    bytesToRead: end - start + 1n,
    contentRange: `bytes ${start}-${end}/${size}`,
  };
}

export const assetFileResponse = Effect.fn("assetFileResponse")(function* (
  asset: {
    readonly path: string;
    readonly download?: boolean;
    readonly fileName?: string;
    readonly mimeType?: string;
    readonly file?: OpenMediaFile;
  },
  rangeHeader?: string,
  ifRangeHeader?: string,
  method: "GET" | "HEAD" = "GET",
) {
  const headers = assetResponseHeaders(asset.path, asset);
  const mediaFile = asset.file;
  const mediaInfo = mediaFile ? yield* statMediaFile(asset.path, mediaFile) : undefined;
  const isVideo = headers["Content-Type"]?.toLowerCase().startsWith("video/") === true;
  if (mediaFile && isVideo) {
    // Host videos can change in place. Do not invite conditional range requests
    // with validators that cannot establish byte-for-byte identity.
    headers["Cache-Control"] = "private, no-store";
  }
  let status = 200;
  let offset = 0n;
  let bytesToRead: bigint | undefined;
  if (isVideo) {
    headers["Accept-Ranges"] = "bytes";
    // If-Range requires a matching validator. A full response is safe when we cannot validate it.
    if (method === "GET" && rangeHeader && ifRangeHeader === undefined) {
      const fs = yield* FileSystem.FileSystem;
      const info = mediaInfo ?? (yield* fs.stat(asset.path));
      const range = assetByteRange(rangeHeader, info.size);
      if (range?._tag === "Unsatisfiable") {
        return HttpServerResponse.empty({
          status: 416,
          headers: { ...headers, "Content-Range": `bytes */${info.size}` },
        });
      }
      if (range?._tag === "Range") {
        status = 206;
        offset = range.offset;
        bytesToRead = range.bytesToRead;
        headers["Content-Range"] = range.contentRange;
      }
    }
  }
  if (mediaFile && mediaInfo) {
    const size = bytesToRead ?? mediaInfo.size;
    headers["Content-Type"] ??= Mime.getType(asset.path) ?? "application/octet-stream";
    headers["Content-Length"] = String(size);
    if (!isVideo) {
      headers["Last-Modified"] = mediaInfo.mtime.toUTCString();
      headers.ETag = `W/"${mediaInfo.size.toString(16)}-${mediaInfo.mtimeMs.toString(16)}"`;
    }
    if (method === "HEAD" || size === 0n) {
      return HttpServerResponse.empty({ status, headers });
    }
    const body = streamMediaFile(mediaFile, offset, size);
    if (!body) {
      return HttpServerResponse.text("File is too large to preview.", { status: 413 });
    }
    return HttpServerResponse.stream(body, {
      status,
      headers,
    });
  }
  return yield* HttpServerResponse.file(asset.path, { status, offset, bytesToRead, headers });
});

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
        failEnvironmentAuthInvalid(
          EnvironmentAuth.serverAuthCredentialReason(error),
          EnvironmentAuth.serverAuthDpopFailureReason(error),
        ),
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
      return yield* assetFileResponse(
        { ...asset, path: requestedPath },
        request.method === "GET" ? request.headers.range : undefined,
        request.headers["if-range"],
        request.method === "HEAD" ? "HEAD" : "GET",
      ).pipe(
        Effect.orElseSucceed(() =>
          HttpServerResponse.text("Internal Server Error", { status: 500 }),
        ),
      );
    }),
  ),
);

export const attachmentUploadRouteLayer = HttpRouter.add(
  "POST",
  `${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }

    const token = url.value.pathname.slice(`${ATTACHMENT_UPLOAD_ROUTE_PREFIX}/`.length);
    if (!token) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    const claims = yield* validateAttachmentUploadToken(token);
    if (!claims) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }

    const contentLengthHeader = request.headers["content-length"];
    if (
      contentLengthHeader !== undefined &&
      (!Number.isInteger(Number(contentLengthHeader)) ||
        Number(contentLengthHeader) !== claims.sizeBytes)
    ) {
      return HttpServerResponse.text("Content-Length must match the upload size.", {
        status: 400,
      });
    }

    // Keep the request stream in the route scope until the response is sent.
    const bodyPull = yield* Stream.toPull(request.stream);
    const stored = yield* storeAttachmentUpload(claims, Stream.fromPull(Effect.succeed(bodyPull)));
    return stored.ok
      ? HttpServerResponse.empty({ status: 204 })
      : HttpServerResponse.text(stored.detail, { status: stored.status });
  }),
);

export const projectTransferUploadRouteLayer = HttpRouter.add(
  "POST",
  `${PROJECT_TRANSFER_UPLOAD_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) {
      return HttpServerResponse.text("Bad Request", { status: 400 });
    }
    const token = url.value.pathname.slice(`${PROJECT_TRANSFER_UPLOAD_ROUTE_PREFIX}/`.length);
    const claims = token ? yield* validateProjectTransferUploadToken(token) : null;
    if (!claims) {
      return HttpServerResponse.text("Not Found", { status: 404 });
    }
    const contentLength = Number(request.headers["content-length"]);
    if (
      Number.isFinite(contentLength) &&
      (contentLength <= 0 || contentLength > PROJECT_TRANSFER_MAX_ARCHIVE_BYTES)
    ) {
      return HttpServerResponse.text("Transfer archive is empty or too large.", { status: 413 });
    }

    const bodyPull = yield* Stream.toPull(request.stream);
    const received = yield* receiveProjectTransfer(
      claims,
      Stream.fromPull(Effect.succeed(bodyPull)),
    );
    return received.ok
      ? HttpServerResponse.jsonUnsafe(received.result)
      : HttpServerResponse.text(received.detail, { status: received.status });
  }),
);

const decodeBuildManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        file: Schema.String,
        css: Schema.optional(Schema.Array(Schema.String)),
        assets: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  ),
);

const loadImmutableBuildAssets = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const staticDir =
    config.staticDir ?? (config.devUrl ? yield* ServerConfig.resolveStaticDir() : undefined);
  if (!staticDir) return new Set<string>();
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return yield* fileSystem.readFileString(path.join(staticDir, ".vite", "manifest.json")).pipe(
    Effect.flatMap(decodeBuildManifest),
    Effect.map(
      (manifest) =>
        new Set(
          Object.values(manifest).flatMap((entry) => [
            entry.file,
            ...(entry.css ?? []),
            ...(entry.assets ?? []),
          ]),
        ),
    ),
    Effect.orElseSucceed(() => new Set<string>()),
  );
});

const openStaticFile = Effect.fn("openStaticFile")(function* (filePath: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  // Reject directories and special files before opening. Response metadata comes from the handle.
  const pathInfo = yield* fileSystem.stat(filePath).pipe(Effect.orElseSucceed(() => null));
  if (pathInfo?.type !== "File") return null;
  const file = yield* fileSystem.open(filePath, { flag: "r" });
  const info = yield* file.stat;
  return info.type === "File" ? { file, info } : null;
});

const streamStaticFile = (file: FileSystem.File, size: bigint) =>
  Stream.unfold(
    0n,
    Effect.fnUntraced(function* (offset: bigint) {
      if (offset >= size) return;
      const remaining = size - offset;
      const bytes = yield* file.readAlloc(remaining < 65_536n ? remaining : 65_536n);
      if (Option.isNone(bytes)) return;
      return [bytes.value, offset + BigInt(bytes.value.byteLength)] as const;
    }),
  );

const handleStaticAndDevRequest = Effect.fn("handleStaticAndDevRequest")(
  function* (immutableBuildAssets: ReadonlySet<string>) {
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

    let opened = yield* openStaticFile(filePath);
    if (!opened) {
      filePath = path.resolve(staticRoot, "index.html");
      opened = yield* openStaticFile(filePath);
      if (!opened) {
        return HttpServerResponse.text("Not Found", { status: 404 });
      }
    }
    const mimeType = Mime.getType(filePath) ?? "application/octet-stream";
    const isHtml = mimeType === "text/html";

    // A hash-like name is not enough: custom static files can use the same naming pattern.
    const relativePath = path.relative(staticRoot, filePath).replaceAll("\\", "/");
    const immutable =
      !isHtml &&
      /^assets\/.+-[\w-]{8}\.[^/]+$/.test(relativePath) &&
      immutableBuildAssets.has(relativePath);
    const headers: Record<string, string> = {
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    };
    // Precompressed siblings are trusted only for assets named by this build's manifest.
    if (immutable && acceptsBrotliEncoding(request.headers["accept-encoding"])) {
      const compressed = yield* openStaticFile(`${filePath}.br`);
      if (compressed) {
        opened = compressed;
        headers["Content-Encoding"] = "br";
      }
    }
    headers.Vary = "Accept-Encoding";
    const fileInfo = opened.info;
    // Deployments can preserve HTML size and mtime while changing its bundle URLs.
    const modifiedAt = isHtml ? undefined : Option.getOrUndefined(fileInfo.mtime);
    const etag = modifiedAt
      ? `W/"${fileInfo.size.toString(16)}-${modifiedAt.getTime().toString(16)}"`
      : undefined;
    if (etag !== undefined && modifiedAt !== undefined) {
      headers.ETag = etag;
      headers["Last-Modified"] = modifiedAt.toUTCString();
    }

    // If-None-Match takes precedence over dates and uses weak comparison for
    // GET/HEAD, including when compression changes the transferred bytes.
    const ifNoneMatch = request.headers["if-none-match"];
    const ifModifiedSince = request.headers["if-modified-since"];
    const unchanged =
      ifNoneMatch !== undefined
        ? ifNoneMatch.split(",").some((value) => {
            const candidate = value.trim();
            return (
              candidate === "*" ||
              (etag !== undefined && candidate.replace(/^W\//i, "") === etag.slice(2))
            );
          })
        : ifModifiedSince !== undefined &&
          modifiedAt !== undefined &&
          Date.parse(modifiedAt.toUTCString()) <= Date.parse(ifModifiedSince);
    if (!isHtml && unchanged) {
      return HttpServerResponse.empty({
        status: 304,
        headers: { ...headers, Vary: "Accept-Encoding" },
      });
    }

    const contentType = isHtml ? "text/html; charset=utf-8" : mimeType;
    // The request scope closes the handle for GET, HEAD, 304, errors, and cancellation.
    // HEAD still passes through compression, which selects headers without reading the stream.
    return HttpServerResponse.stream(streamStaticFile(opened.file, fileInfo.size), {
      headers,
      contentType,
      contentLength: Number(fileInfo.size),
    });
  },
  Effect.catchTags({
    PlatformError: () =>
      Effect.succeed(HttpServerResponse.text("Internal Server Error", { status: 500 })),
  }),
);

// Read the installed build's manifest once. Unknown files use revalidation.
export const staticAndDevRouteLayer = Layer.unwrap(
  loadImmutableBuildAssets.pipe(
    Effect.map((assets) => HttpRouter.add("GET", "*", handleStaticAndDevRequest(assets))),
  ),
);
