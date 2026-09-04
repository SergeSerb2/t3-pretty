import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import { AUTH_ACCESS_TOKEN_MAX_EXPIRES_IN_SECONDS } from "./auth.ts";
import {
  RELAY_AUTHORIZATION_HEADER_MAX_LENGTH,
  RELAY_APP_VERSION_MAX_LENGTH,
  RELAY_BUNDLE_ID_MAX_LENGTH,
  RELAY_DEVICE_ID_MAX_LENGTH,
  RELAY_DPOP_PROOF_MAX_LENGTH,
  RELAY_ENVIRONMENT_ID_MAX_LENGTH,
  RELAY_IOS_MAJOR_VERSION_MAX,
  RELAY_PERSISTED_USER_ID_MAX_LENGTH,
  RELAY_THREAD_ID_MAX_LENGTH,
  RELAY_TIMESTAMP_MAX_LENGTH,
  RelayApi,
  RelayAgentActivityPublishProofPayload,
  RelayBearerRequestHeaders,
  RelayCloudUserId,
  RelayClientDeviceRecord,
  RelayDeviceRegistrationRequest,
  RelayDeliveryResult,
  RelayDpopProofRequestHeaders,
  RelayDpopRequestHeaders,
  RelayDpopAccessTokenResponse,
  RelayEnvironmentLinkLimitExceededError,
} from "./relay.ts";

const decodeBearerHeaders = Schema.decodeUnknownSync(RelayBearerRequestHeaders);
const decodeDpopProofHeaders = Schema.decodeUnknownSync(RelayDpopProofRequestHeaders);
const decodeDpopHeaders = Schema.decodeUnknownSync(RelayDpopRequestHeaders);
const decodeDeliveryResult = Schema.decodeUnknownSync(RelayDeliveryResult);
const decodeLinkLimitError = Schema.decodeUnknownSync(RelayEnvironmentLinkLimitExceededError);
const decodePublishProofPayload = Schema.decodeUnknownSync(RelayAgentActivityPublishProofPayload);
const decodeAccessTokenResponse = Schema.decodeUnknownSync(RelayDpopAccessTokenResponse);
const decodeDeviceRegistration = Schema.decodeUnknownSync(RelayDeviceRegistrationRequest);
const decodeClientDeviceRecord = Schema.decodeUnknownSync(RelayClientDeviceRecord);
const decodeCloudUserId = Schema.decodeUnknownSync(RelayCloudUserId);

describe("RelayApi security", () => {
  it("describes DPoP access tokens using the HTTP DPoP authorization scheme", () => {
    const document = OpenApi.fromApi(RelayApi);

    expect(document.components.securitySchemes?.relayDpop).toEqual({
      type: "http",
      scheme: "DPoP",
      description: "DPoP-bound access token. Requests must also include the DPoP proof JWT header.",
    });
  });

  it("rejects oversized bearer and DPoP headers before relay parsing", () => {
    const oversizedAuthorization = "x".repeat(RELAY_AUTHORIZATION_HEADER_MAX_LENGTH + 1);
    const oversizedProof = "x".repeat(RELAY_DPOP_PROOF_MAX_LENGTH + 1);

    expect(() => decodeBearerHeaders({ authorization: oversizedAuthorization })).toThrow();
    expect(() => decodeDpopProofHeaders({ dpop: oversizedProof })).toThrow();
    expect(() =>
      decodeDpopHeaders({ authorization: "DPoP access-token", dpop: oversizedProof }),
    ).toThrow();
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid relay counts and APNs statuses: %s",
    (value) => {
      expect(() =>
        decodeLinkLimitError({
          _tag: "RelayEnvironmentLinkLimitExceededError",
          code: "environment_link_limit_exceeded",
          maxTunnels: value,
          traceId: "trace-1",
        }),
      ).toThrow();
      expect(() =>
        decodeDeliveryResult({
          deviceId: "device-1",
          kind: "push_notification",
          ok: false,
          apnsStatus: value,
          apnsReason: null,
          apnsId: null,
        }),
      ).toThrow();
    },
  );

  it("rejects negative registered timestamps and implausible token lifetimes", () => {
    expect(() =>
      decodePublishProofPayload({
        iss: "issuer",
        aud: "audience",
        sub: "subject",
        jti: "jwt-1",
        iat: -1,
        exp: 1,
        environmentId: "environment-1",
        threadId: "thread-1",
        state: null,
      }),
    ).toThrow();
    expect(() =>
      decodeAccessTokenResponse({
        access_token: "access-token",
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "DPoP",
        expires_in: AUTH_ACCESS_TOKEN_MAX_EXPIRES_IN_SECONDS + 1,
        scope: "environment:connect",
      }),
    ).toThrow();
  });

  it("rejects relay identifiers and timestamps that cannot fit their persistence columns", () => {
    const proof = {
      iss: "issuer",
      aud: "audience",
      sub: "subject",
      jti: "jwt-1",
      iat: 1,
      exp: 2,
      environmentId: "environment-1",
      threadId: "thread-1",
      state: null,
    };
    expect(() =>
      decodePublishProofPayload({
        ...proof,
        environmentId: "e".repeat(RELAY_ENVIRONMENT_ID_MAX_LENGTH + 1),
      }),
    ).toThrow();
    expect(() =>
      decodePublishProofPayload({
        ...proof,
        threadId: "t".repeat(RELAY_THREAD_ID_MAX_LENGTH + 1),
      }),
    ).toThrow();

    const registration = {
      deviceId: "device-1",
      label: "iPhone",
      platform: "ios",
      iosMajorVersion: 18,
      preferences: {
        liveActivitiesEnabled: true,
        notificationsEnabled: true,
        notifyOnApproval: true,
        notifyOnInput: true,
        notifyOnCompletion: true,
        notifyOnFailure: true,
      },
    };
    expect(() =>
      decodeDeviceRegistration({
        ...registration,
        deviceId: "d".repeat(RELAY_DEVICE_ID_MAX_LENGTH + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeDeviceRegistration({
        ...registration,
        appVersion: "v".repeat(RELAY_APP_VERSION_MAX_LENGTH + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeDeviceRegistration({
        ...registration,
        bundleId: "b".repeat(RELAY_BUNDLE_ID_MAX_LENGTH + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeDeviceRegistration({
        ...registration,
        iosMajorVersion: RELAY_IOS_MAJOR_VERSION_MAX + 1,
      }),
    ).toThrow();

    expect(() =>
      decodeClientDeviceRecord({
        ...registration,
        appVersion: null,
        notifications: {
          enabled: true,
          notifyOnApproval: true,
          notifyOnInput: true,
          notifyOnCompletion: true,
          notifyOnFailure: true,
        },
        liveActivities: { enabled: true },
        updatedAt: "2".repeat(RELAY_TIMESTAMP_MAX_LENGTH + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeClientDeviceRecord({
        ...registration,
        appVersion: null,
        notifications: {
          enabled: true,
          notifyOnApproval: true,
          notifyOnInput: true,
          notifyOnCompletion: true,
          notifyOnFailure: true,
        },
        liveActivities: { enabled: true },
        updatedAt: "zzzz",
      }),
    ).toThrow();

    expect(() => decodeCloudUserId("u".repeat(RELAY_PERSISTED_USER_ID_MAX_LENGTH + 1))).toThrow();
  });
});
