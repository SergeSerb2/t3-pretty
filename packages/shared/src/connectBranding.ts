/** User-facing names for the selected managed connection service. */
export type ConnectBuildFlavor = "public" | "internal";

declare const __T3CODE_BUILD_FLAVOR__: ConnectBuildFlavor | undefined;
declare const process:
  | {
      readonly env: Readonly<Record<string, string | undefined>>;
    }
  | undefined;
const processBuildFlavor =
  typeof process === "undefined"
    ? undefined
    : (process.env.EXPO_PUBLIC_T3CODE_BUILD_FLAVOR ?? process.env.T3CODE_BUILD_FLAVOR);
export const T3CODE_BUILD_FLAVOR: ConnectBuildFlavor =
  (typeof __T3CODE_BUILD_FLAVOR__ !== "undefined"
    ? __T3CODE_BUILD_FLAVOR__
    : processBuildFlavor) === "internal"
    ? "internal"
    : "public";

export interface ConnectBranding {
  readonly accountName: string;
  readonly connectName: string;
}

export const T3_CONNECT_BRANDING: ConnectBranding = {
  accountName: "T3",
  connectName: "T3 Connect",
};

export const SURGE_CONNECT_BRANDING: ConnectBranding = {
  accountName: "Surge Code",
  connectName: "Surge Connect",
};

export function connectBrandingForFlavor(flavor: ConnectBuildFlavor): ConnectBranding {
  return flavor === "internal" ? SURGE_CONNECT_BRANDING : T3_CONNECT_BRANDING;
}

export const CONNECT_BRANDING = connectBrandingForFlavor(T3CODE_BUILD_FLAVOR);

// Legacy names keep the existing import surface small while their values follow
// the selected build. New code should prefer CONNECT_BRANDING.
export const SURGE_CODE_ACCOUNT_NAME = CONNECT_BRANDING.accountName;
export const SURGE_CONNECT_NAME = CONNECT_BRANDING.connectName;

/** Internal R2 feed and public GitHub release feed for this fork's CLI. */
const INTERNAL_CLI_TARBALL_FEED_URL =
  "https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest";
const PUBLIC_CLI_RELEASE_BASE_URL = "https://github.com/SergeSerb2/t3-pretty/releases";

export const FORK_CLI_TARBALL_FEED_URL =
  T3CODE_BUILD_FLAVOR === "internal"
    ? INTERNAL_CLI_TARBALL_FEED_URL
    : `${PUBLIC_CLI_RELEASE_BASE_URL}/latest/download`;

export const FORK_CLI_INSTALL_SCRIPT_URL = `${FORK_CLI_TARBALL_FEED_URL}/install.sh`;

export function forkCliTarballFileName(version?: string): string {
  const trimmed = version?.trim();
  return trimmed ? `t3-${trimmed}.tgz` : "t3.tgz";
}

export function forkCliTarballUrl(
  version?: string,
  flavor: ConnectBuildFlavor = T3CODE_BUILD_FLAVOR,
): string {
  const trimmed = version?.trim();
  const baseUrl =
    flavor === "internal"
      ? INTERNAL_CLI_TARBALL_FEED_URL
      : trimmed
        ? `${PUBLIC_CLI_RELEASE_BASE_URL}/download/public-v${trimmed}`
        : `${PUBLIC_CLI_RELEASE_BASE_URL}/latest/download`;
  return `${baseUrl}/${forkCliTarballFileName(trimmed)}`;
}

/** One-shot command that runs this fork's CLI, not upstream `npx t3`. */
export function forkCliCommand(subcommand = "", version?: string): string {
  const prefix = `npx --yes --package ${forkCliTarballUrl(version)} t3`;
  const trimmed = subcommand.trim();
  return trimmed ? `${prefix} ${trimmed}` : prefix;
}
