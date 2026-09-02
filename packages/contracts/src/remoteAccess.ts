import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

// These ceilings are deliberately generous relative to every endpoint the
// desktop currently produces. They keep the IPC payload finite without
// changing ordinary local, Tailscale, or manually configured endpoint data.
export const ADVERTISED_ENDPOINTS_MAX_ITEMS = 64;
export const ADVERTISED_ENDPOINT_PROVIDER_ID_MAX_LENGTH = 512;
export const ADVERTISED_ENDPOINT_PROVIDER_LABEL_MAX_LENGTH = 512;
export const ADVERTISED_ENDPOINT_ID_MAX_LENGTH = 16_384;
export const ADVERTISED_ENDPOINT_LABEL_MAX_LENGTH = 512;
export const ADVERTISED_ENDPOINT_URL_MAX_LENGTH = 8_192;
export const ADVERTISED_ENDPOINT_DESCRIPTION_MAX_LENGTH = 4_096;

const AdvertisedEndpointProviderId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(ADVERTISED_ENDPOINT_PROVIDER_ID_MAX_LENGTH),
);
const AdvertisedEndpointProviderLabel = TrimmedNonEmptyString.check(
  Schema.isMaxLength(ADVERTISED_ENDPOINT_PROVIDER_LABEL_MAX_LENGTH),
);
const AdvertisedEndpointId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(ADVERTISED_ENDPOINT_ID_MAX_LENGTH),
);
const AdvertisedEndpointLabel = TrimmedNonEmptyString.check(
  Schema.isMaxLength(ADVERTISED_ENDPOINT_LABEL_MAX_LENGTH),
);
const AdvertisedEndpointUrl = TrimmedNonEmptyString.check(
  Schema.isMaxLength(ADVERTISED_ENDPOINT_URL_MAX_LENGTH),
);
const AdvertisedEndpointDescription = TrimmedNonEmptyString.check(
  Schema.isMaxLength(ADVERTISED_ENDPOINT_DESCRIPTION_MAX_LENGTH),
);

export const AdvertisedEndpointProviderKind = Schema.Literals([
  "core",
  "private-network",
  "tunnel",
  "manual",
]);
export type AdvertisedEndpointProviderKind = typeof AdvertisedEndpointProviderKind.Type;

export const AdvertisedEndpointReachability = Schema.Literals([
  "loopback",
  "lan",
  "private-network",
  "public",
]);
export type AdvertisedEndpointReachability = typeof AdvertisedEndpointReachability.Type;

export const AdvertisedEndpointHostedHttpsCompatibility = Schema.Literals([
  "compatible",
  "mixed-content-blocked",
  "requires-configuration",
  "unknown",
]);
export type AdvertisedEndpointHostedHttpsCompatibility =
  typeof AdvertisedEndpointHostedHttpsCompatibility.Type;

export const AdvertisedEndpointStatus = Schema.Literals(["available", "unavailable", "unknown"]);
export type AdvertisedEndpointStatus = typeof AdvertisedEndpointStatus.Type;

export const AdvertisedEndpointSource = Schema.Literals([
  "desktop-core",
  "desktop-addon",
  "server",
  "user",
]);
export type AdvertisedEndpointSource = typeof AdvertisedEndpointSource.Type;

export const AdvertisedEndpointProvider = Schema.Struct({
  id: AdvertisedEndpointProviderId,
  label: AdvertisedEndpointProviderLabel,
  kind: AdvertisedEndpointProviderKind,
  isAddon: Schema.Boolean,
});
export type AdvertisedEndpointProvider = typeof AdvertisedEndpointProvider.Type;

export const AdvertisedEndpointCompatibility = Schema.Struct({
  hostedHttpsApp: AdvertisedEndpointHostedHttpsCompatibility,
  desktopApp: Schema.Literals(["compatible", "unknown"]),
});
export type AdvertisedEndpointCompatibility = typeof AdvertisedEndpointCompatibility.Type;

export const AdvertisedEndpoint = Schema.Struct({
  id: AdvertisedEndpointId,
  label: AdvertisedEndpointLabel,
  provider: AdvertisedEndpointProvider,
  httpBaseUrl: AdvertisedEndpointUrl,
  wsBaseUrl: AdvertisedEndpointUrl,
  reachability: AdvertisedEndpointReachability,
  compatibility: AdvertisedEndpointCompatibility,
  source: AdvertisedEndpointSource,
  status: AdvertisedEndpointStatus,
  isDefault: Schema.optional(Schema.Boolean),
  description: Schema.optional(AdvertisedEndpointDescription),
});
export type AdvertisedEndpoint = typeof AdvertisedEndpoint.Type;

export const AdvertisedEndpoints = Schema.Array(AdvertisedEndpoint).check(
  Schema.isMaxLength(ADVERTISED_ENDPOINTS_MAX_ITEMS),
);
export type AdvertisedEndpoints = typeof AdvertisedEndpoints.Type;
