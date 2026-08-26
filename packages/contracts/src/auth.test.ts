import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  AUTH_ACCESS_CLIENT_SESSION_MAX_COUNT,
  AUTH_ACCESS_PAIRING_LINK_MAX_COUNT,
  AUTH_ACCESS_TOKEN_MAX_EXPIRES_IN_SECONDS,
  AUTH_CLIENT_USER_AGENT_MAX_LENGTH,
  AUTH_CREDENTIAL_MAX_LENGTH,
  AUTH_ERROR_MESSAGE_MAX_LENGTH,
  AUTH_IDENTIFIER_MAX_LENGTH,
  AuthAccessStreamError,
  AuthAccessStreamEvent,
  AuthAccessTokenResult,
  AuthBrowserSessionRequest,
  AuthClientMetadata,
  AuthClientSessions,
  AuthPairingLinks,
  AuthRevokePairingLinkInput,
  AuthTokenExchangeRequest,
} from "./auth.ts";

const decodeBrowserSessionRequest = Schema.decodeUnknownSync(AuthBrowserSessionRequest);
const decodeTokenExchangeRequest = Schema.decodeUnknownSync(AuthTokenExchangeRequest);
const decodeClientMetadata = Schema.decodeUnknownSync(AuthClientMetadata);
const decodeRevokePairingLinkInput = Schema.decodeUnknownSync(AuthRevokePairingLinkInput);
const decodePairingLinks = Schema.decodeUnknownSync(AuthPairingLinks);
const decodeClientSessions = Schema.decodeUnknownSync(AuthClientSessions);
const decodeAccessTokenResult = Schema.decodeUnknownSync(AuthAccessTokenResult);
const decodeAccessStreamEvent = Schema.decodeUnknownSync(AuthAccessStreamEvent);
const now = DateTime.makeUnsafe(0);

describe("auth contract resource bounds", () => {
  it("rejects oversized bootstrap and access credentials", () => {
    const oversizedCredential = "x".repeat(AUTH_CREDENTIAL_MAX_LENGTH + 1);

    expect(() => decodeBrowserSessionRequest({ credential: oversizedCredential })).toThrow();
    expect(() =>
      decodeTokenExchangeRequest({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: oversizedCredential,
        subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      }),
    ).toThrow();
  });

  it("rejects oversized client metadata and access identifiers", () => {
    expect(() =>
      decodeClientMetadata({
        deviceType: "unknown",
        userAgent: "x".repeat(AUTH_CLIENT_USER_AGENT_MAX_LENGTH + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeRevokePairingLinkInput({ id: "x".repeat(AUTH_IDENTIFIER_MAX_LENGTH + 1) }),
    ).toThrow();
  });

  it("rejects pairing-link collections larger than the server snapshot budget", () => {
    const pairingLink = {
      id: "pairing-link",
      credential: "PAIRINGTOKEN",
      scopes: ["orchestration:read"],
      subject: "one-time-token",
      createdAt: now,
      expiresAt: now,
    } as const;

    expect(() =>
      decodePairingLinks(
        Array.from({ length: AUTH_ACCESS_PAIRING_LINK_MAX_COUNT + 1 }, () => pairingLink),
      ),
    ).toThrow();
  });

  it("rejects client-session collections larger than the server snapshot budget", () => {
    const clientSession = {
      sessionId: "session-id",
      subject: "browser",
      scopes: ["orchestration:read"],
      method: "browser-session-cookie",
      client: { deviceType: "unknown" },
      issuedAt: now,
      expiresAt: now,
      lastConnectedAt: null,
      connected: false,
      current: false,
    } as const;

    expect(() =>
      decodeClientSessions(
        Array.from({ length: AUTH_ACCESS_CLIENT_SESSION_MAX_COUNT + 1 }, () => clientSession),
      ),
    ).toThrow();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid access-token lifetime: %s",
    (expiresIn) => {
      expect(() =>
        decodeAccessTokenResult({
          access_token: "access-token",
          issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
          token_type: "Bearer",
          expires_in: expiresIn,
          scope: "orchestration:read",
        }),
      ).toThrow();
    },
  );

  it("rejects access-token lifetimes that would outlive the integer contract", () => {
    expect(() =>
      decodeAccessTokenResult({
        access_token: "access-token",
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "Bearer",
        expires_in: AUTH_ACCESS_TOKEN_MAX_EXPIRES_IN_SECONDS + 1,
        scope: "orchestration:read",
      }),
    ).toThrow();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects an invalid access-stream revision: %s",
    (revision) => {
      expect(() =>
        decodeAccessStreamEvent({
          version: 1,
          revision,
          type: "snapshot",
          payload: { pairingLinks: [], clientSessions: [] },
        }),
      ).toThrow();
    },
  );

  it("bounds producer-supplied access-stream diagnostics", () => {
    const error = new AuthAccessStreamError({
      message: "x".repeat(AUTH_ERROR_MESSAGE_MAX_LENGTH + 1),
    });

    expect(error.message).toHaveLength(AUTH_ERROR_MESSAGE_MAX_LENGTH);
  });
});
