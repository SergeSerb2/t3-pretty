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
  AuthEnvironmentScope,
  AuthEnvironmentScopes,
  AuthGrantScopes,
  AuthPairingLinks,
  AuthRevokePairingLinkInput,
  AuthSessionState,
  AuthStandardClientScopes,
  AuthTokenExchangeRequest,
  authScopeRequiredResponse,
  authScopeResponse,
  sessionGrantsScope,
  sessionHasLegacyPermissions,
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

describe("authorization grants", () => {
  it("decodes legacy review credentials without offering them in new grants", () => {
    expect(Schema.decodeUnknownSync(AuthEnvironmentScopes)(["review:write"])).toEqual([
      "review:write",
    ]);
    expect(() => Schema.decodeUnknownSync(AuthGrantScopes)(["review:write"])).toThrow();
    expect(AuthStandardClientScopes).not.toContain("review:write");
  });

  // Frozen vocabulary from the client before granular scopes shipped. Do not
  // derive it from the current enum: that would hide compatibility regressions.
  const oldScopes = Schema.Array(
    Schema.Literals([
      "orchestration:read",
      "orchestration:operate",
      "terminal:operate",
      "review:write",
      "access:read",
      "access:write",
      "relay:read",
      "relay:write",
    ]),
  );

  const decodeOldScopes = Schema.decodeUnknownSync(oldScopes);

  it.each(AuthEnvironmentScope.literals)(
    "keeps %s permission errors decodable by old clients",
    (scope) => {
      const response = authScopeRequiredResponse(scope);
      expect(decodeOldScopes([response.requiredScope])).toEqual([response.requiredScope]);
      expect(response.requiredPermission).toBe(scope);
    },
  );

  it("keeps old clients able to decode grants with new permissions", () => {
    const response = authScopeResponse(AuthStandardClientScopes);
    expect(decodeOldScopes(response.scopes)).toEqual(response.scopes);
    expect(response.permissions).toEqual(AuthStandardClientScopes);
    expect(response.scopes).not.toContain("filesystem:read");
  });

  it("ignores unknown response permissions without falling back to broader scopes", () => {
    const session = Schema.decodeUnknownSync(AuthSessionState)({
      authenticated: true,
      auth: {
        policy: "loopback-browser",
        bootstrapMethods: [],
        sessionMethods: [],
        sessionCookieName: "session",
      },
      scopes: ["orchestration:operate"],
      permissions: ["future:permission"],
    });
    expect(session.permissions).toEqual([]);
    expect(sessionGrantsScope(session, "orchestration:operate")).toBe(false);
    expect(sessionGrantsScope(session, "settings:write")).toBe(false);
  });

  it.each([
    {
      label: "exact permissions over the legacy presentation",
      session: {
        authenticated: true,
        scopes: ["orchestration:operate"],
        permissions: ["filesystem:read"],
      },
      scope: "settings:write",
      expected: false,
    },
    {
      label: "a permission absent from the legacy presentation",
      session: { authenticated: true, scopes: [], permissions: ["filesystem:read"] },
      scope: "filesystem:read",
      expected: true,
    },

    {
      label: "the parent on a server that predates the split",
      session: { authenticated: true, scopes: ["orchestration:operate"], auth: {} },
      scope: "settings:write",
      expected: true,
    },
    {
      label: "only the exact scope on a server that knows the split",
      session: {
        authenticated: true,
        scopes: ["orchestration:operate"],
        auth: { serverUpdateScope: "environment:maintain" },
      },
      scope: "settings:write",
      expected: false,
    },
    {
      label: "the exact scope regardless of server version",
      session: { authenticated: true, scopes: ["settings:write"], auth: {} },
      scope: "settings:write",
      expected: true,
    },
    {
      label: "nothing for an unauthenticated session",
      session: { authenticated: false, scopes: ["orchestration:operate"], auth: {} },
      scope: "settings:write",
      expected: false,
    },
    {
      label: "no parent for scopes that were never split",
      session: { authenticated: true, scopes: ["orchestration:operate"], auth: {} },
      scope: "access:write",
      expected: false,
    },
  ] as const)("sessionGrantsScope accepts $label", ({ session, scope, expected }) => {
    expect(sessionGrantsScope(session, scope)).toBe(expected);
  });
});

describe("legacy permission notice", () => {
  it.each(["orchestration:read", "orchestration:operate", "terminal:operate"] as const)(
    "recognizes an old %s grant on an upgraded server",
    (scope) =>
      expect(sessionHasLegacyPermissions({ authenticated: true, permissions: [scope] })).toBe(true),
  );
  it("waits for a new server and an authenticated session", () => {
    expect(
      sessionHasLegacyPermissions({ authenticated: true, scopes: ["orchestration:operate"] }),
    ).toBe(false);
    expect(
      sessionHasLegacyPermissions({ authenticated: false, permissions: ["orchestration:operate"] }),
    ).toBe(false);
  });
  it("skips new grants and old grants that lost no implied permissions", () => {
    for (const permissions of [
      AuthStandardClientScopes,
      ["orchestration:read", "filesystem:read"] as const,
      ["access:read"] as const,
      [],
    ]) {
      expect(sessionHasLegacyPermissions({ authenticated: true, permissions })).toBe(false);
    }
  });
});
