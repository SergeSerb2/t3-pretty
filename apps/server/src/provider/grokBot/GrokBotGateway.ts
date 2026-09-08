/**
 * GrokBotGateway — transport for the Grok Bot provider.
 *
 * Grok Bot has no CLI. A bot runs on a persistent cloud "box" owned by the
 * user's Cursor account. Two private surfaces are involved, both reached with
 * the Cursor access token that `cursor-agent login` stores:
 *
 *   1. `api2.cursor.sh/aiserver.v1.GrokBotService/*` — ConnectRPC. We speak
 *      Connect-JSON so no protobuf toolchain is needed. Used to locate the box
 *      (`EnsureSandBox`) and as the auth probe.
 *   2. The box gateway — plain `POST {gatewayUrl}/api/{command}` JSON commands
 *      and a `GET {gatewayUrl}/events` server-sent-event feed carrying every
 *      transcript entry and roster change. This is what the desktop app uses
 *      for the live conversation, and it is the only surface that creates
 *      box-hosted bots.
 *
 * Wire shapes were lifted from the Grok Bot desktop bundle; they are not a
 * public API and may change with a Grok Bot release.
 *
 * @module provider/grokBot/GrokBotGateway
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

import { spawnAndCollect } from "../providerSnapshot.ts";

export const CURSOR_API_BASE_URL = "https://api2.cursor.sh";
const GROK_BOT_SERVICE = "aiserver.v1.GrokBotService";
/** Client version the desktop app reports; the backend gates on it. */
const SAND_CLIENT_VERSION = "0.39.0";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

export class GrokBotGatewayError extends Schema.TaggedErrorClass<GrokBotGatewayError>()(
  "GrokBotGatewayError",
  {
    operation: Schema.String,
    detail: Schema.String,
    status: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Grok Bot ${this.operation} failed${this.status === undefined ? "" : ` (${this.status})`}: ${this.detail}`;
  }
  get unauthenticated(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

// ── Cursor request headers ─────────────────────────────────────────────

/**
 * `x-cursor-checksum`: an obfuscated coarse timestamp prefix followed by the
 * machine id. Mirrors the desktop's implementation so the backend accepts us
 * as a Grok Bot client.
 */
export function cursorChecksum(machineId: string, nowMs: number): string {
  const t = Math.floor(nowMs / 1e6);
  const bytes = new Uint8Array([
    (t >> 40) & 255,
    (t >> 32) & 255,
    (t >> 24) & 255,
    (t >> 16) & 255,
    (t >> 8) & 255,
    t & 255,
  ]);
  let key = 165;
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = ((bytes[index]! ^ key) + (index % 256)) & 255;
    key = bytes[index]!;
  }
  return `${Buffer.from(bytes).toString("base64url")}${machineId}`;
}

export function cursorApiHeaders(input: {
  readonly accessToken: string;
  readonly machineId: string;
  readonly nowMs: number;
}): Record<string, string> {
  return {
    authorization: `Bearer ${input.accessToken}`,
    "x-cursor-checksum": cursorChecksum(input.machineId, input.nowMs),
    "x-cursor-client-type": "sand",
    "x-cursor-client-source": "sand-desktop",
    "x-cursor-client-version": SAND_CLIENT_VERSION,
    "x-sand-box-namespace": "prod",
    "x-ghost-mode": "true",
    "connect-protocol-version": "1",
  };
}

// ── Cursor access token ────────────────────────────────────────────────

/**
 * Locate the Cursor access token the way `cursor-agent` stores it: macOS
 * Keychain (`cursor-access-token` / `cursor-user`), otherwise `auth.json`
 * in the platform config dir. An explicit token wins so remote hosts without
 * the Cursor CLI can still run Grok Bot.
 */
export const resolveCursorAccessToken = Effect.fn("resolveCursorAccessToken")(function* (input: {
  readonly explicitToken?: string | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
}) {
  const explicit = input.explicitToken?.trim();
  if (explicit) return explicit;
  const env = input.environment ?? process.env;
  const fromEnv = env.CURSOR_ACCESS_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const platform = yield* HostProcessPlatform;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = env.HOME ?? env.USERPROFILE ?? "";

  if (platform === "darwin") {
    const result = yield* spawnAndCollect(
      "security",
      ChildProcess.make(
        "security",
        ["find-generic-password", "-s", "cursor-access-token", "-a", "cursor-user", "-w"],
        { env },
      ),
    ).pipe(Effect.option);
    const token =
      result._tag === "Some" && result.value.code === 0 ? result.value.stdout.trim() : "";
    if (token) return token;
  }

  const authFile =
    platform === "win32"
      ? path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), "Cursor", "auth.json")
      : platform === "darwin"
        ? path.join(home, ".cursor", "auth.json")
        : path.join(env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "cursor", "auth.json");
  const contents = yield* fileSystem.readFileString(authFile).pipe(Effect.option);
  if (contents._tag === "Some") {
    const parsed = decodeAuthFile(contents.value);
    const token = parsed._tag === "Some" ? parsed.value.accessToken?.trim() : undefined;
    if (token) return token;
  }
  return undefined;
});

const AuthFile = Schema.Struct({ accessToken: Schema.optional(Schema.String) });
const decodeAuthFile = Schema.decodeUnknownOption(Schema.fromJsonString(AuthFile));

// ── Box connection ─────────────────────────────────────────────────────

const EnsureSandBoxResponse = Schema.Struct({
  gatewayUrl: Schema.String,
  gatewayToken: Schema.String,
  networkToken: Schema.String,
});
const decodeEnsureSandBox = Schema.decodeUnknownOption(EnsureSandBoxResponse);

export interface BoxConnection {
  readonly gatewayUrl: string;
  readonly gatewayToken: string;
  readonly networkToken: string;
}

/** One `data:` payload from the gateway `/events` feed. */
export interface GatewayEvent {
  readonly channel: string;
  readonly payload: unknown;
}

const GatewayEventSchema = Schema.Struct({ channel: Schema.String, payload: Schema.Unknown });
const decodeGatewayEvent = Schema.decodeUnknownOption(Schema.fromJsonString(GatewayEventSchema));

/**
 * Incremental SSE parser. Feed it raw text chunks; it returns the complete
 * `data:` payloads that became available and the leftover buffer. Comment
 * lines (`:ping`) and `retry:` fields are dropped. LF and CRLF framing are
 * both accepted.
 */
export function parseSseChunk(
  buffer: string,
  chunk: string,
): readonly [buffer: string, events: ReadonlyArray<GatewayEvent>] {
  // Normalize CRLF frames; a `\r` split from its `\n` by a chunk boundary is
  // joined here because the buffer is re-scanned with the next chunk.
  let rest = (buffer + chunk).replace(/\r\n/g, "\n");
  const events: Array<GatewayEvent> = [];
  for (;;) {
    const boundary = rest.indexOf("\n\n");
    if (boundary < 0) break;
    const block = rest.slice(0, boundary);
    rest = rest.slice(boundary + 2);
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    // A malformed frame is skipped; the feed keeps flowing.
    const decoded = decodeGatewayEvent(data);
    if (decoded._tag === "Some") events.push(decoded.value);
  }
  return [rest, events];
}

export interface GrokBotClient {
  /** Unary Connect-JSON call on `aiserver.v1.GrokBotService`. */
  readonly api: (method: string, body: unknown) => Effect.Effect<unknown, GrokBotGatewayError>;
  /** Locate the user's box; cached until a gateway call is rejected. */
  readonly ensureBox: Effect.Effect<BoxConnection, GrokBotGatewayError>;
  /** `POST {gateway}/api/{command}` on the box. */
  readonly command: (command: string, args: unknown) => Effect.Effect<unknown, GrokBotGatewayError>;
  /**
   * One `/events` connection. Ends when the box closes it; the consumer
   * decides whether to reconnect.
   */
  readonly events: Stream.Stream<GatewayEvent, GrokBotGatewayError>;
}

export interface GrokBotClientOptions {
  readonly accessToken: Effect.Effect<string | undefined>;
  readonly machineId: string;
  readonly apiBaseUrl?: string | undefined;
}

export const makeGrokBotClient = Effect.fn("makeGrokBotClient")(function* (
  options: GrokBotClientOptions,
) {
  const httpClient = yield* HttpClient.HttpClient;
  const apiBaseUrl = options.apiBaseUrl ?? CURSOR_API_BASE_URL;
  const boxRef = yield* Ref.make<BoxConnection | undefined>(undefined);

  const requireToken = (operation: string) =>
    options.accessToken.pipe(
      Effect.flatMap((token) =>
        token
          ? Effect.succeed(token)
          : Effect.fail(
              new GrokBotGatewayError({
                operation,
                status: 401,
                detail:
                  "No Cursor access token. Run `cursor-agent login` on this machine or set one in Grok Bot settings.",
              }),
            ),
      ),
    );

  const readJson = (operation: string, response: HttpClientResponse.HttpClientResponse) =>
    response.text.pipe(
      Effect.mapError(
        (cause) =>
          new GrokBotGatewayError({
            operation,
            status: response.status,
            detail: "Unreadable response body.",
            cause,
          }),
      ),
      Effect.flatMap((text) => {
        if (response.status < 200 || response.status >= 300) {
          return Effect.fail(
            new GrokBotGatewayError({
              operation,
              status: response.status,
              detail: summarizeErrorBody(text) ?? `HTTP ${response.status}`,
            }),
          );
        }
        if (!text.trim()) return Effect.succeed<unknown>({});
        const parsed = decodeJson(text);
        return parsed._tag === "Some"
          ? Effect.succeed(parsed.value)
          : Effect.fail(
              new GrokBotGatewayError({
                operation,
                status: response.status,
                detail: "Response was not JSON.",
              }),
            );
      }),
    );

  const api: GrokBotClient["api"] = (method, body) =>
    Effect.gen(function* () {
      const operation = `api/${method}`;
      const accessToken = yield* requireToken(operation);
      const nowMs = yield* Clock.currentTimeMillis;
      const response = yield* HttpClientRequest.post(
        `${apiBaseUrl}/${GROK_BOT_SERVICE}/${method}`,
      ).pipe(
        HttpClientRequest.setHeaders(
          cursorApiHeaders({ accessToken, machineId: options.machineId, nowMs }),
        ),
        HttpClientRequest.bodyText(encodeJson(body ?? {}), "application/json"),
        httpClient.execute,
        Effect.mapError(
          (cause) => new GrokBotGatewayError({ operation, detail: "Request failed.", cause }),
        ),
      );
      return yield* readJson(operation, response);
    });

  const ensureBox: GrokBotClient["ensureBox"] = Effect.gen(function* () {
    const cached = yield* Ref.get(boxRef);
    if (cached) return cached;
    const raw = yield* api("EnsureSandBox", {});
    const decoded = decodeEnsureSandBox(raw);
    if (decoded._tag === "None" || !decoded.value.gatewayUrl) {
      return yield* new GrokBotGatewayError({
        operation: "api/EnsureSandBox",
        detail: "The backend did not return a box gateway.",
      });
    }
    yield* Ref.set(boxRef, decoded.value);
    return decoded.value;
  });

  const gatewayHeaders = (box: BoxConnection) => ({
    authorization: `Bearer ${box.gatewayToken}`,
    "x-anyrun-network-token": box.networkToken,
  });

  const command: GrokBotClient["command"] = (name, args) =>
    Effect.gen(function* () {
      const operation = `gateway/${name}`;
      const box = yield* ensureBox;
      const response = yield* HttpClientRequest.post(`${box.gatewayUrl}/api/${name}`).pipe(
        HttpClientRequest.setHeaders({
          ...gatewayHeaders(box),
          "content-type": "application/json",
        }),
        HttpClientRequest.bodyText(encodeJson(args ?? {}), "application/json"),
        httpClient.execute,
        Effect.mapError(
          (cause) => new GrokBotGatewayError({ operation, detail: "Request failed.", cause }),
        ),
      );
      // A rejected gateway credential means the box moved or the token
      // rotated: drop the cache so the next call re-resolves the box.
      if (response.status === 401 || response.status === 403 || response.status >= 500) {
        yield* Ref.set(boxRef, undefined);
      }
      return yield* readJson(operation, response);
    });

  const events: GrokBotClient["events"] = Stream.unwrap(
    Effect.gen(function* () {
      const operation = "gateway/events";
      const box = yield* ensureBox;
      const response = yield* HttpClientRequest.get(`${box.gatewayUrl}/events`).pipe(
        HttpClientRequest.setHeaders({ ...gatewayHeaders(box), accept: "text/event-stream" }),
        httpClient.execute,
        Effect.mapError(
          (cause) => new GrokBotGatewayError({ operation, detail: "Request failed.", cause }),
        ),
      );
      if (response.status < 200 || response.status >= 300) {
        yield* Ref.set(boxRef, undefined);
        return yield* new GrokBotGatewayError({
          operation,
          status: response.status,
          detail: `HTTP ${response.status}`,
        });
      }
      return response.stream.pipe(
        Stream.decodeText(),
        // Effect 4 `mapAccum` takes a lazy seed and flattens the returned
        // `values` array, so each parsed frame is emitted on its own. See the
        // client-level test in GrokBotGateway.test.ts.
        Stream.mapAccum(
          () => "",
          (buffer, chunk) => parseSseChunk(buffer, chunk),
        ),
        Stream.mapError(
          (cause) => new GrokBotGatewayError({ operation, detail: "Event stream failed.", cause }),
        ),
      );
    }),
  );

  return { api, ensureBox, command, events } satisfies GrokBotClient;
});

/** Pull a human-readable detail out of a Connect or gateway error body. */
function summarizeErrorBody(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parsed = decodeErrorBody(trimmed);
  if (parsed._tag === "None") return trimmed.slice(0, 200);
  const body = parsed.value;
  const detail = body.details?.[0]?.debug?.details;
  return (
    detail?.detail ??
    detail?.title ??
    (body.message && body.message !== "Error" ? body.message : undefined) ??
    body.code
  );
}

const ErrorBody = Schema.Struct({
  message: Schema.optional(Schema.String),
  code: Schema.optional(Schema.String),
  details: Schema.optional(
    Schema.Array(
      Schema.Struct({
        debug: Schema.optional(
          Schema.Struct({
            details: Schema.optional(
              Schema.Struct({
                detail: Schema.optional(Schema.String),
                title: Schema.optional(Schema.String),
              }),
            ),
          }),
        ),
      }),
    ),
  ),
});
const decodeErrorBody = Schema.decodeUnknownOption(Schema.fromJsonString(ErrorBody));

export type GrokBotClientEnv =
  | HttpClient.HttpClient
  | FileSystem.FileSystem
  | Path.Path
  | ChildProcessSpawner.ChildProcessSpawner;
