import * as Schema from "effect/Schema";

export const CLERK_PUBLISHABLE_KEY_MAX_LENGTH = 16 * 1024;
export const CLERK_FRONTEND_API_MAX_LENGTH = 253;

const ClerkPublishableKeyPrefix = Schema.Literals(["pk_test", "pk_live", "unknown"]);

export class ClerkPublishableKeyDecodeError extends Schema.TaggedErrorClass<ClerkPublishableKeyDecodeError>()(
  "ClerkPublishableKeyDecodeError",
  {
    keyPrefix: ClerkPublishableKeyPrefix,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to decode Clerk publishable key (${this.keyPrefix}).`;
  }
}

export class ClerkPublishableKeyFrontendApiError extends Schema.TaggedErrorClass<ClerkPublishableKeyFrontendApiError>()(
  "ClerkPublishableKeyFrontendApiError",
  {
    keyPrefix: ClerkPublishableKeyPrefix,
    frontendApi: Schema.String.check(Schema.isMaxLength(CLERK_FRONTEND_API_MAX_LENGTH)),
    reason: Schema.Literals(["empty", "too-long", "contains-path", "invalid-url"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Invalid Clerk frontend API decoded from publishable key (${this.keyPrefix}; ${this.reason}).`;
  }
}

function parseClerkFrontendApi(publishableKey: string): {
  readonly hostname: string;
  readonly url: string;
} {
  const keyPrefix = publishableKey.startsWith("pk_test_")
    ? "pk_test"
    : publishableKey.startsWith("pk_live_")
      ? "pk_live"
      : "unknown";
  if (publishableKey.length > CLERK_PUBLISHABLE_KEY_MAX_LENGTH) {
    throw new ClerkPublishableKeyDecodeError({
      keyPrefix,
      cause: new RangeError(
        `Clerk publishable key exceeds ${CLERK_PUBLISHABLE_KEY_MAX_LENGTH} characters.`,
      ),
    });
  }
  const encodedFrontendApi = publishableKey.split("_").slice(2).join("_");
  let frontendApi: string;
  try {
    frontendApi = globalThis.atob(encodedFrontendApi).replace(/\$$/u, "");
  } catch (cause) {
    throw new ClerkPublishableKeyDecodeError({ keyPrefix, cause });
  }

  if (frontendApi.length === 0) {
    throw new ClerkPublishableKeyFrontendApiError({
      keyPrefix,
      frontendApi,
      reason: "empty",
    });
  }
  if (frontendApi.length > CLERK_FRONTEND_API_MAX_LENGTH) {
    throw new ClerkPublishableKeyFrontendApiError({
      keyPrefix,
      frontendApi: `${frontendApi.slice(0, CLERK_FRONTEND_API_MAX_LENGTH - 1)}…`,
      reason: "too-long",
    });
  }
  if (frontendApi.includes("/")) {
    throw new ClerkPublishableKeyFrontendApiError({
      keyPrefix,
      frontendApi,
      reason: "contains-path",
    });
  }

  const url = `https://${frontendApi}`;
  try {
    return { hostname: new URL(url).hostname, url };
  } catch (cause) {
    throw new ClerkPublishableKeyFrontendApiError({
      keyPrefix,
      frontendApi,
      reason: "invalid-url",
      cause,
    });
  }
}

export function clerkFrontendApiUrlFromPublishableKey(publishableKey: string): string {
  return parseClerkFrontendApi(publishableKey).url;
}

export function clerkFrontendApiHostnameFromPublishableKey(publishableKey: string): string {
  return parseClerkFrontendApi(publishableKey).hostname;
}

export function isAllowedClerkFrontendApiHostname(
  hostname: string,
  configuredHostname: string | null,
): boolean {
  return (
    hostname.endsWith(".clerk.accounts.dev") ||
    hostname.endsWith(".clerk.accounts.com") ||
    hostname === configuredHostname
  );
}

export function relayClerkTokenOptions(template: string) {
  return {
    template,
    skipCache: true,
  } as const;
}
