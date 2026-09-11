import {
  AUTH_CLIENT_LABEL_MAX_LENGTH,
  AUTH_CREDENTIAL_MAX_LENGTH,
  DESKTOP_BOOTSTRAP_HOST_MAX_LENGTH,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const PAIRING_TOKEN_PARAM = "token";
const HOSTED_PAIRING_HOST_PARAM = "host";
const HOSTED_PAIRING_LABEL_PARAM = "label";
const SUPPORTED_REMOTE_BACKEND_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);
export const REMOTE_PAIRING_URL_MAX_LENGTH = 32 * 1024;
export const REMOTE_PAIRING_HOST_MAX_LENGTH = DESKTOP_BOOTSTRAP_HOST_MAX_LENGTH;
export const REMOTE_PAIRING_TOKEN_MAX_LENGTH = AUTH_CREDENTIAL_MAX_LENGTH;
export const REMOTE_PAIRING_LABEL_MAX_LENGTH = AUTH_CLIENT_LABEL_MAX_LENGTH;

const boundedTrimmedValue = (value: string | null | undefined, maxLength: number): string => {
  if (value === null || value === undefined || value.length > maxLength) {
    return "";
  }
  return value.trim();
};

const isBoundedPairingUrl = (url: URL): boolean =>
  url.toString().length <= REMOTE_PAIRING_URL_MAX_LENGTH;

export const readHashParams = (url: URL): URLSearchParams => {
  if (url.hash.length > REMOTE_PAIRING_URL_MAX_LENGTH) {
    return new URLSearchParams();
  }
  return new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
};

export class RemoteBackendUrlMissingError extends Schema.TaggedErrorClass<RemoteBackendUrlMissingError>()(
  "RemoteBackendUrlMissingError",
  {},
) {
  override get message(): string {
    return "Enter a backend URL.";
  }
}

export class RemotePairingUrlInvalidError extends Schema.TaggedErrorClass<RemotePairingUrlInvalidError>()(
  "RemotePairingUrlInvalidError",
  {
    cause: Schema.optional(Schema.Defect()),
    protocol: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return "Pairing URL is invalid.";
  }
}

export class RemoteBackendUrlInvalidError extends Schema.TaggedErrorClass<RemoteBackendUrlInvalidError>()(
  "RemoteBackendUrlInvalidError",
  {
    source: Schema.Literals(["direct-host", "hosted-pairing-host"]),
    cause: Schema.optional(Schema.Defect()),
    protocol: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return "Backend URL is invalid.";
  }
}

export class RemotePairingTokenMissingError extends Schema.TaggedErrorClass<RemotePairingTokenMissingError>()(
  "RemotePairingTokenMissingError",
  { host: Schema.String },
) {
  override get message(): string {
    return "Pairing URL is missing its token.";
  }
}

export class RemotePairingCodeMissingError extends Schema.TaggedErrorClass<RemotePairingCodeMissingError>()(
  "RemotePairingCodeMissingError",
  { host: Schema.String },
) {
  override get message(): string {
    return "Enter a pairing code.";
  }
}

export const RemotePairingTargetError = Schema.Union([
  RemoteBackendUrlMissingError,
  RemotePairingUrlInvalidError,
  RemoteBackendUrlInvalidError,
  RemotePairingTokenMissingError,
  RemotePairingCodeMissingError,
]);
export type RemotePairingTargetError = typeof RemotePairingTargetError.Type;

const hasSupportedRemoteBackendProtocol = (url: URL): boolean =>
  SUPPORTED_REMOTE_BACKEND_PROTOCOLS.has(url.protocol);

const normalizeRemoteBaseUrl = (
  rawValue: string,
  source: RemoteBackendUrlInvalidError["source"],
): URL => {
  if (rawValue.length > REMOTE_PAIRING_HOST_MAX_LENGTH) {
    throw new RemoteBackendUrlInvalidError({ source });
  }
  const trimmed = boundedTrimmedValue(rawValue, REMOTE_PAIRING_HOST_MAX_LENGTH);
  if (!trimmed) {
    throw new RemoteBackendUrlMissingError();
  }

  const withoutLeadingSlashes = trimmed.replace(/^\/+/, "");
  const normalizedInput = /^[a-zA-Z][a-zA-Z\d+-]*:\/\//.test(withoutLeadingSlashes)
    ? withoutLeadingSlashes
    : `https://${withoutLeadingSlashes}`;
  let url: URL;
  try {
    url = new URL(normalizedInput);
  } catch (cause) {
    throw new RemoteBackendUrlInvalidError({ source, cause });
  }
  if (!hasSupportedRemoteBackendProtocol(url)) {
    throw new RemoteBackendUrlInvalidError({
      source,
      protocol: url.protocol,
    });
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
};

const toHttpBaseUrl = (url: URL): string => {
  const next = new URL(url.toString());
  if (next.protocol === "ws:") {
    next.protocol = "http:";
  } else if (next.protocol === "wss:") {
    next.protocol = "https:";
  }
  next.pathname = "/";
  next.search = "";
  next.hash = "";
  return next.toString();
};

const toWsBaseUrl = (url: URL): string => {
  const next = new URL(url.toString());
  if (next.protocol === "http:") {
    next.protocol = "ws:";
  } else if (next.protocol === "https:") {
    next.protocol = "wss:";
  }
  next.pathname = "/";
  next.search = "";
  next.hash = "";
  return next.toString();
};

export interface ResolvedRemotePairingTarget {
  readonly credential: string;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

export interface HostedPairingRequest {
  readonly host: string;
  readonly token: string;
  readonly label: string;
}

export const getPairingTokenFromUrl = (url: URL): string | null => {
  if (!isBoundedPairingUrl(url)) {
    return null;
  }
  const hashToken = boundedTrimmedValue(
    readHashParams(url).get(PAIRING_TOKEN_PARAM),
    REMOTE_PAIRING_TOKEN_MAX_LENGTH,
  );
  if (hashToken.length > 0) {
    return hashToken;
  }

  const searchToken = boundedTrimmedValue(
    url.searchParams.get(PAIRING_TOKEN_PARAM),
    REMOTE_PAIRING_TOKEN_MAX_LENGTH,
  );
  return searchToken.length > 0 ? searchToken : null;
};

export const stripPairingTokenFromUrl = (url: URL): URL => {
  const next = new URL(url.toString());
  if (next.hash.length > REMOTE_PAIRING_URL_MAX_LENGTH) {
    next.hash = "";
  } else {
    const hashParams = readHashParams(next);
    if (hashParams.has(PAIRING_TOKEN_PARAM)) {
      hashParams.delete(PAIRING_TOKEN_PARAM);
      next.hash = hashParams.toString();
    }
  }
  next.searchParams.delete(PAIRING_TOKEN_PARAM);
  return next;
};

export const setPairingTokenOnUrl = (url: URL, credential: string): URL => {
  const boundedCredential = boundedTrimmedValue(credential, REMOTE_PAIRING_TOKEN_MAX_LENGTH);
  if (boundedCredential.length === 0) {
    throw new RangeError("Pairing credential is empty or too long.");
  }
  const next = new URL(url.toString());
  next.searchParams.delete(PAIRING_TOKEN_PARAM);
  next.hash = new URLSearchParams([[PAIRING_TOKEN_PARAM, boundedCredential]]).toString();
  if (!isBoundedPairingUrl(next)) {
    throw new RangeError("Pairing URL is too long.");
  }
  return next;
};

export const readHostedPairingRequest = (url: URL): HostedPairingRequest | null => {
  if (!isBoundedPairingUrl(url)) {
    return null;
  }
  const host = boundedTrimmedValue(
    url.searchParams.get(HOSTED_PAIRING_HOST_PARAM),
    REMOTE_PAIRING_HOST_MAX_LENGTH,
  );
  const token = getPairingTokenFromUrl(url) ?? "";
  const label = boundedTrimmedValue(
    url.searchParams.get(HOSTED_PAIRING_LABEL_PARAM),
    REMOTE_PAIRING_LABEL_MAX_LENGTH,
  );

  if (!host || !token) {
    return null;
  }

  return {
    host,
    token,
    label,
  };
};

export const resolveRemotePairingTarget = (input: {
  readonly pairingUrl?: string;
  readonly host?: string;
  readonly pairingCode?: string;
}): ResolvedRemotePairingTarget => {
  const rawPairingUrl = input.pairingUrl ?? "";
  if (rawPairingUrl.length > REMOTE_PAIRING_URL_MAX_LENGTH) {
    throw new RemotePairingUrlInvalidError();
  }
  const pairingUrl = boundedTrimmedValue(rawPairingUrl, REMOTE_PAIRING_URL_MAX_LENGTH);
  if (pairingUrl.length > 0) {
    let url: URL;
    try {
      url = new URL(pairingUrl);
    } catch (cause) {
      throw new RemotePairingUrlInvalidError({ cause });
    }
    if (!hasSupportedRemoteBackendProtocol(url)) {
      throw new RemotePairingUrlInvalidError({
        protocol: url.protocol,
      });
    }
    const hasHostedHost = url.searchParams.has(HOSTED_PAIRING_HOST_PARAM);
    const hostedPairingRequest = readHostedPairingRequest(url);
    if (hasHostedHost) {
      if (!hostedPairingRequest) {
        if (!getPairingTokenFromUrl(url)) {
          throw new RemotePairingTokenMissingError({ host: url.host });
        }
        throw new RemoteBackendUrlInvalidError({ source: "hosted-pairing-host" });
      }
      const hostedBackendUrl = normalizeRemoteBaseUrl(
        hostedPairingRequest.host,
        "hosted-pairing-host",
      );
      return {
        credential: hostedPairingRequest.token,
        httpBaseUrl: toHttpBaseUrl(hostedBackendUrl),
        wsBaseUrl: toWsBaseUrl(hostedBackendUrl),
      };
    }

    const credential = getPairingTokenFromUrl(url) ?? "";
    if (!credential) {
      throw new RemotePairingTokenMissingError({ host: url.host });
    }
    return {
      credential,
      httpBaseUrl: toHttpBaseUrl(url),
      wsBaseUrl: toWsBaseUrl(url),
    };
  }

  const rawHost = input.host ?? "";
  const rawPairingCode = input.pairingCode ?? "";
  const host = boundedTrimmedValue(rawHost, REMOTE_PAIRING_HOST_MAX_LENGTH);
  const pairingCode = boundedTrimmedValue(rawPairingCode, REMOTE_PAIRING_TOKEN_MAX_LENGTH);
  if (!host) {
    if (rawHost.length > REMOTE_PAIRING_HOST_MAX_LENGTH) {
      throw new RemoteBackendUrlInvalidError({ source: "direct-host" });
    }
    throw new RemoteBackendUrlMissingError();
  }
  const normalizedHost = normalizeRemoteBaseUrl(host, "direct-host");
  if (!pairingCode) {
    throw new RemotePairingCodeMissingError({ host: normalizedHost.host });
  }

  return {
    credential: pairingCode,
    httpBaseUrl: toHttpBaseUrl(normalizedHost),
    wsBaseUrl: toWsBaseUrl(normalizedHost),
  };
};
