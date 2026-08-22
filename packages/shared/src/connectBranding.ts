/**
 * User-facing names for the fork-operated managed connection service.
 *
 * Protocol names, environment variables, API routes, and the `t3 connect`
 * command stay unchanged for upstream compatibility.
 */
export const SURGE_CODE_ACCOUNT_NAME = "Surge Code";
export const SURGE_CONNECT_NAME = "Surge Connect";

/**
 * Public R2 directory that already serves desktop updater files. Headless CLI
 * tarballs (`t3.tgz`, `t3-<version>.tgz`) and `install.sh` live here too.
 * `npx t3` is upstream T3 Code and must not be used for this fork.
 */
export const FORK_CLI_TARBALL_FEED_URL =
  "https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest";

export const FORK_CLI_INSTALL_SCRIPT_URL = `${FORK_CLI_TARBALL_FEED_URL}/install.sh`;

export function forkCliTarballFileName(version?: string): string {
  const trimmed = version?.trim();
  return trimmed ? `t3-${trimmed}.tgz` : "t3.tgz";
}

export function forkCliTarballUrl(version?: string): string {
  return `${FORK_CLI_TARBALL_FEED_URL}/${forkCliTarballFileName(version)}`;
}

/** One-shot command that runs this fork's CLI, not upstream `npx t3`. */
export function forkCliCommand(subcommand = "", version?: string): string {
  const prefix = `npx --yes --package ${forkCliTarballUrl(version)} t3`;
  const trimmed = subcommand.trim();
  return trimmed ? `${prefix} ${trimmed}` : prefix;
}
