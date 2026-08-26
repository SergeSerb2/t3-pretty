import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  ADVERTISED_ENDPOINT_DESCRIPTION_MAX_LENGTH,
  ADVERTISED_ENDPOINT_ID_MAX_LENGTH,
  ADVERTISED_ENDPOINT_LABEL_MAX_LENGTH,
  ADVERTISED_ENDPOINT_PROVIDER_ID_MAX_LENGTH,
  ADVERTISED_ENDPOINT_PROVIDER_LABEL_MAX_LENGTH,
  ADVERTISED_ENDPOINT_URL_MAX_LENGTH,
  ADVERTISED_ENDPOINTS_MAX_ITEMS,
  AdvertisedEndpoint,
  AdvertisedEndpoints,
  type AdvertisedEndpoint as AdvertisedEndpointValue,
} from "./remoteAccess.ts";

const endpoint = {
  id: "desktop-loopback:3773",
  label: "This machine",
  provider: {
    id: "desktop-core",
    label: "Desktop",
    kind: "core",
    isAddon: false,
  },
  httpBaseUrl: "http://127.0.0.1:3773/",
  wsBaseUrl: "ws://127.0.0.1:3773/",
  reachability: "loopback",
  compatibility: {
    hostedHttpsApp: "mixed-content-blocked",
    desktopApp: "compatible",
  },
  source: "desktop-core",
  status: "available",
  description: "Loopback endpoint for this desktop app.",
} satisfies AdvertisedEndpointValue;

const decodeEndpoint = Schema.decodeUnknownSync(AdvertisedEndpoint);
const encodeEndpoint = Schema.encodeUnknownSync(AdvertisedEndpoint);
const encodeEndpoints = Schema.encodeUnknownSync(AdvertisedEndpoints);

const urlAtLength = (protocol: "http" | "ws", length: number): string => {
  const prefix = `${protocol}://example.test/`;
  return `${prefix}${"x".repeat(length - prefix.length)}`;
};

describe("advertised endpoint contracts", () => {
  it("keeps the existing endpoint shape wire-compatible", () => {
    expect(decodeEndpoint(endpoint)).toEqual(endpoint);
    expect(encodeEndpoint(endpoint)).toEqual(endpoint);
  });

  it("accepts current field ceilings and rejects one-character overflows", () => {
    const cases: ReadonlyArray<{
      readonly maximum: number;
      readonly update: (value: string) => AdvertisedEndpointValue;
    }> = [
      {
        maximum: ADVERTISED_ENDPOINT_PROVIDER_ID_MAX_LENGTH,
        update: (value) => ({ ...endpoint, provider: { ...endpoint.provider, id: value } }),
      },
      {
        maximum: ADVERTISED_ENDPOINT_PROVIDER_LABEL_MAX_LENGTH,
        update: (value) => ({ ...endpoint, provider: { ...endpoint.provider, label: value } }),
      },
      {
        maximum: ADVERTISED_ENDPOINT_ID_MAX_LENGTH,
        update: (value) => ({ ...endpoint, id: value }),
      },
      {
        maximum: ADVERTISED_ENDPOINT_LABEL_MAX_LENGTH,
        update: (value) => ({ ...endpoint, label: value }),
      },
      {
        maximum: ADVERTISED_ENDPOINT_DESCRIPTION_MAX_LENGTH,
        update: (value) => ({ ...endpoint, description: value }),
      },
    ];

    for (const testCase of cases) {
      expect(() => encodeEndpoint(testCase.update("x".repeat(testCase.maximum)))).not.toThrow();
      expect(() => encodeEndpoint(testCase.update("x".repeat(testCase.maximum + 1)))).toThrow();
    }

    expect(() =>
      encodeEndpoint({
        ...endpoint,
        httpBaseUrl: urlAtLength("http", ADVERTISED_ENDPOINT_URL_MAX_LENGTH),
        wsBaseUrl: urlAtLength("ws", ADVERTISED_ENDPOINT_URL_MAX_LENGTH),
      }),
    ).not.toThrow();
    expect(() =>
      encodeEndpoint({
        ...endpoint,
        httpBaseUrl: urlAtLength("http", ADVERTISED_ENDPOINT_URL_MAX_LENGTH + 1),
      }),
    ).toThrow();
  });

  it("bounds the aggregate desktop IPC result", () => {
    const atLimit = Array.from({ length: ADVERTISED_ENDPOINTS_MAX_ITEMS }, () => endpoint);
    expect(() => encodeEndpoints(atLimit)).not.toThrow();
    expect(() => encodeEndpoints([...atLimit, endpoint])).toThrow();
  });
});
