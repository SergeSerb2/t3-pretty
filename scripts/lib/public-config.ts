// @effect-diagnostics nodeBuiltinImport:off - Build bootstrap reads optional root env files before an Effect runtime exists.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

export interface T3CodePublicConfig {
  readonly buildFlavor: "public" | "internal";
  readonly clerkPublishableKey: string | undefined;
  readonly clerkJwtTemplate: string | undefined;
  readonly clerkCliOAuthClientId: string | undefined;
  readonly relayUrl: string | undefined;
  readonly mobileOtlpTracesUrl: string | undefined;
  readonly mobileOtlpTracesDataset: string | undefined;
  readonly mobileOtlpTracesToken: string | undefined;
  readonly relayClientOtlpTracesUrl: string | undefined;
  readonly relayClientOtlpTracesDataset: string | undefined;
  readonly relayClientOtlpTracesToken: string | undefined;
}

type Environment = Readonly<Record<string, string | undefined>>;

export const PUBLIC_DESKTOP_UPDATE_FEED_URL =
  "https://github.com/SergeSerb2/t3-pretty/releases/latest/download/";

const REPO_ROOT = NodePath.dirname(
  NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url))),
);
const MAX_REPO_ENV_BYTES = 1024 * 1024;
const MAX_RELEASE_TRAIN_MARKER_BYTES = 1024;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;

export function loadRepoEnv({
  baseEnv = process.env,
  repoRoot = REPO_ROOT,
}: {
  readonly baseEnv?: Environment;
  readonly repoRoot?: string;
} = {}): Record<string, string | undefined> {
  const rootEnv = readEnvFile(NodePath.join(repoRoot, ".env"));
  const localEnv = readEnvFile(NodePath.join(repoRoot, ".env.local"));
  const flavor = resolveBuildFlavor(baseEnv, localEnv, rootEnv);
  const defaults = readEnvFile(
    NodePath.join(repoRoot, flavor === "internal" ? ".env.internal.example" : ".env.example"),
  );
  const config = resolvePublicConfig(baseEnv, localEnv, rootEnv, defaults);

  const env = {
    ...rootEnv,
    ...localEnv,
    ...baseEnv,
    ...(config.clerkPublishableKey
      ? {
          T3CODE_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
          VITE_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
          EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
        }
      : {}),
    ...(config.clerkJwtTemplate
      ? {
          T3CODE_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
          VITE_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
          EXPO_PUBLIC_CLERK_JWT_TEMPLATE: config.clerkJwtTemplate,
        }
      : {}),
    ...(config.clerkCliOAuthClientId
      ? {
          T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: config.clerkCliOAuthClientId,
          VITE_CLERK_CLI_OAUTH_CLIENT_ID: config.clerkCliOAuthClientId,
        }
      : {}),
    ...(config.relayUrl
      ? {
          T3CODE_RELAY_URL: config.relayUrl,
          VITE_T3CODE_RELAY_URL: config.relayUrl,
        }
      : {}),
    T3CODE_BUILD_FLAVOR: flavor,
    VITE_T3CODE_BUILD_FLAVOR: flavor,
    EXPO_PUBLIC_T3CODE_BUILD_FLAVOR: flavor,
    ...(config.mobileOtlpTracesUrl
      ? {
          T3CODE_MOBILE_OTLP_TRACES_URL: config.mobileOtlpTracesUrl,
          EXPO_PUBLIC_OTLP_TRACES_URL: config.mobileOtlpTracesUrl,
        }
      : {}),
    ...(config.mobileOtlpTracesDataset
      ? {
          T3CODE_MOBILE_OTLP_TRACES_DATASET: config.mobileOtlpTracesDataset,
          EXPO_PUBLIC_OTLP_TRACES_DATASET: config.mobileOtlpTracesDataset,
        }
      : {}),
    ...(config.mobileOtlpTracesToken
      ? {
          T3CODE_MOBILE_OTLP_TRACES_TOKEN: config.mobileOtlpTracesToken,
          EXPO_PUBLIC_OTLP_TRACES_TOKEN: config.mobileOtlpTracesToken,
        }
      : {}),
    ...(config.relayClientOtlpTracesUrl
      ? {
          T3CODE_RELAY_CLIENT_OTLP_TRACES_URL: config.relayClientOtlpTracesUrl,
          VITE_RELAY_OTLP_TRACES_URL: config.relayClientOtlpTracesUrl,
        }
      : {}),
    ...(config.relayClientOtlpTracesDataset
      ? {
          T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET: config.relayClientOtlpTracesDataset,
          VITE_RELAY_OTLP_TRACES_DATASET: config.relayClientOtlpTracesDataset,
        }
      : {}),
    ...(config.relayClientOtlpTracesToken
      ? {
          T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: config.relayClientOtlpTracesToken,
          VITE_RELAY_OTLP_TRACES_TOKEN: config.relayClientOtlpTracesToken,
        }
      : {}),
  };
  if (isPublicReleaseBuild(env, repoRoot)) assertPublicReleaseConfig(env);
  return env;
}

/** Official snapshots and explicit release builds must never inherit maintainer services. */
export function isPublicReleaseBuild(env: Environment, repoRoot = REPO_ROOT): boolean {
  return (
    env.T3CODE_PUBLIC_RELEASE === "1" ||
    NodeFS.existsSync(NodePath.join(repoRoot, ".t3-fork/public-release.json"))
  );
}

export function assertPublicReleaseConfig(env: Environment): void {
  const config = resolvePublicConfig(env);
  const expected = {
    buildFlavor: "public",
    clerkPublishableKey: "pk_live_Y2xlcmsudDMuY29kZXMk",
    clerkJwtTemplate: "t3-relay",
    clerkCliOAuthClientId: "hzxSgY2cH10sDU2r",
    relayUrl: "https://relay.t3.codes",
  } as const;
  for (const [key, value] of Object.entries(expected)) {
    if (config[key as keyof typeof expected] !== value) {
      throw new Error(`Public release requires official T3 Connect configuration (${key}).`);
    }
  }
  const domains = env.T3CODE_CLERK_PASSKEY_RP_DOMAINS?.trim();
  if (domains && domains.split(",").some((domain) => domain.trim() !== "clerk.t3.codes")) {
    throw new Error("Public release passkey domains must use clerk.t3.codes.");
  }
  const updateFeed = env.T3CODE_DESKTOP_UPDATE_FEED_URL?.trim();
  if (updateFeed && updateFeed !== PUBLIC_DESKTOP_UPDATE_FEED_URL) {
    throw new Error("Public release desktop updates must use the public GitHub feed.");
  }
  const updateRepository = env.T3CODE_DESKTOP_UPDATE_REPOSITORY?.trim();
  if (updateRepository && updateRepository !== "SergeSerb2/t3-pretty") {
    throw new Error("Public release desktop updates must use the public GitHub repository.");
  }
  // No public client tracing destination is configured. These values are
  // embedded in web bundles and Expo manifests, including their ingest tokens.
  if (
    config.mobileOtlpTracesUrl ||
    config.mobileOtlpTracesDataset ||
    config.mobileOtlpTracesToken ||
    config.relayClientOtlpTracesUrl ||
    config.relayClientOtlpTracesDataset ||
    config.relayClientOtlpTracesToken
  ) {
    throw new Error("Public release must not include inherited client tracing configuration.");
  }
  // A public EAS project is optional for native local builds. Only a separately
  // selected public project may enable OTA; disabling updates does not make an
  // inherited internal EAS identity safe to publish.
  const project = env.T3CODE_MOBILE_EAS_PROJECT_ID?.trim();
  const publicProject = env.T3CODE_PUBLIC_MOBILE_EAS_PROJECT_ID?.trim();
  const internalProject = "1eb51d67-48c5-4100-8aa8-f5ac9e1ada65";
  if (project && (project.toLowerCase() === internalProject || project !== publicProject)) {
    throw new Error("Public release requires a distinct, explicitly selected public EAS project.");
  }
  const updateUrl = env.T3CODE_MOBILE_UPDATE_URL?.trim();
  if (updateUrl && (!project || updateUrl !== `https://u.expo.dev/${project}`)) {
    throw new Error("Public release OTA URL must match its selected public EAS project.");
  }
}

/**
 * Version of the T3 Pretty release train. Public snapshots use their cut version;
 * explicit public builds use the aligned web package version. Internal builds
 * prefer the upstream nightly marker so mobile binaries advance with the code
 * they ship. Other builds fall back to apps/web/package.json. The mobile app derives
 * its CFBundleShortVersionString from this (app.config.ts cannot compute a
 * repo-relative path itself: Expo's config loader evaluates it as CJS, where
 * import.meta is unavailable).
 */
export function readReleaseTrainVersion(
  repoRoot = REPO_ROOT,
  env: Environment = process.env,
): string | undefined {
  if (isPublicReleaseBuild(env, repoRoot)) {
    const marker = readUtf8FileBounded(
      NodePath.join(repoRoot, ".t3-fork/public-release.json"),
      MAX_RELEASE_TRAIN_MARKER_BYTES,
    );
    if (marker) {
      const version = (JSON.parse(marker) as { version?: unknown }).version;
      if (
        typeof version !== "string" ||
        !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
      ) {
        throw new Error("Public release marker must contain a numeric release version.");
      }
      return version;
    }
  } else {
    try {
      const nightly = readUtf8FileBounded(
        NodePath.join(repoRoot, ".t3-fork/upstream-nightly"),
        MAX_RELEASE_TRAIN_MARKER_BYTES,
      )?.trim();
      if (!nightly) throw new Error("No fork release-train marker");
      if (/^v?\d+\.\d+\.\d+/.test(nightly)) return nightly.replace(/^v/, "");
    } catch {
      // Non-fork and pre-sync checkouts use the package version below.
    }
  }

  try {
    const raw = readUtf8FileBounded(
      NodePath.join(repoRoot, "apps/web/package.json"),
      MAX_PACKAGE_JSON_BYTES,
    );
    if (!raw) return undefined;
    const version = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof version === "string" ? version : undefined;
  } catch {
    return undefined;
  }
}

export function resolvePublicConfig(...sources: readonly Environment[]): T3CodePublicConfig {
  return {
    buildFlavor: resolveBuildFlavor(...sources),
    clerkPublishableKey: firstNonEmpty(
      sources,
      "T3CODE_CLERK_PUBLISHABLE_KEY",
      "VITE_CLERK_PUBLISHABLE_KEY",
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
    ),
    clerkJwtTemplate: firstNonEmpty(
      sources,
      "T3CODE_CLERK_JWT_TEMPLATE",
      "VITE_CLERK_JWT_TEMPLATE",
      "EXPO_PUBLIC_CLERK_JWT_TEMPLATE",
    ),
    clerkCliOAuthClientId: firstNonEmpty(
      sources,
      "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID",
      "VITE_CLERK_CLI_OAUTH_CLIENT_ID",
    ),
    relayUrl: firstNonEmpty(sources, "T3CODE_RELAY_URL", "VITE_T3CODE_RELAY_URL"),
    mobileOtlpTracesUrl: firstNonEmpty(
      sources,
      "T3CODE_MOBILE_OTLP_TRACES_URL",
      "EXPO_PUBLIC_OTLP_TRACES_URL",
    ),
    mobileOtlpTracesDataset: firstNonEmpty(
      sources,
      "T3CODE_MOBILE_OTLP_TRACES_DATASET",
      "EXPO_PUBLIC_OTLP_TRACES_DATASET",
    ),
    mobileOtlpTracesToken: firstNonEmpty(
      sources,
      "T3CODE_MOBILE_OTLP_TRACES_TOKEN",
      "EXPO_PUBLIC_OTLP_TRACES_TOKEN",
    ),
    relayClientOtlpTracesUrl: firstNonEmpty(
      sources,
      "T3CODE_RELAY_CLIENT_OTLP_TRACES_URL",
      "VITE_RELAY_OTLP_TRACES_URL",
    ),
    relayClientOtlpTracesDataset: firstNonEmpty(
      sources,
      "T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET",
      "VITE_RELAY_OTLP_TRACES_DATASET",
    ),
    relayClientOtlpTracesToken: firstNonEmpty(
      sources,
      "T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN",
      "VITE_RELAY_OTLP_TRACES_TOKEN",
    ),
  };
}

export type T3CodeBuildFlavor = "public" | "internal";

export function resolveBuildFlavor(...sources: readonly Environment[]): T3CodeBuildFlavor {
  return firstNonEmpty(
    sources,
    "T3CODE_BUILD_FLAVOR",
    "VITE_T3CODE_BUILD_FLAVOR",
    "EXPO_PUBLIC_T3CODE_BUILD_FLAVOR",
  ) === "internal"
    ? "internal"
    : "public";
}

function firstNonEmpty(sources: readonly Environment[], ...names: readonly string[]) {
  for (const source of sources) {
    for (const name of names) {
      const value = source[name]?.trim();
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function readEnvFile(path: string): Record<string, string | undefined> {
  const source = readUtf8FileBounded(path, MAX_REPO_ENV_BYTES);
  return source === undefined ? {} : NodeUtil.parseEnv(source);
}

function readUtf8FileBounded(path: string, maxBytes: number): string | undefined {
  let file: number;
  try {
    file = NodeFS.openSync(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  try {
    if (NodeFS.fstatSync(file).size > maxBytes) {
      throw new Error(
        `Build configuration file exceeds the ${maxBytes}-byte safety limit: ${path}`,
      );
    }
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const read = NodeFS.readSync(file, bytes, length, bytes.byteLength - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > maxBytes) {
      throw new Error(
        `Build configuration file exceeds the ${maxBytes}-byte safety limit: ${path}`,
      );
    }
    return bytes.subarray(0, length).toString("utf8");
  } finally {
    NodeFS.closeSync(file);
  }
}
