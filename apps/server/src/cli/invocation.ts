import * as Effect from "effect/Effect";

import { forkCliTarballUrl } from "@t3tools/shared/connectBranding";
import { HostProcessArguments } from "@t3tools/shared/hostProcess";

import packageJson from "../../package.json" with { type: "json" };

export type CliRunner = "npx" | "pnpm dlx" | "bunx";

/**
 * How the CLI was launched, judged by where its entry script lives. Each
 * package runner executes out of a distinctive cache/temp layout:
 *
 *   npx      ~/.npm/_npx/<hash>/node_modules/...
 *   pnpm dlx ~/.cache/pnpm/dlx/..., $PNPM_HOME/.pnpm/dlx/...,
 *            or %LOCALAPPDATA%/pnpm-cache/dlx/... on Windows
 *   bunx     ~/.bun/install/cache/... or $TMPDIR/bunx-<uid>-<spec>/...
 *
 * Global installs and repo checkouts match none of these and return null.
 * Detection is best-effort; callers must fail closed to a plain `t3` command.
 */
export function detectCliRunner(entryPath: string): CliRunner | null {
  const path = entryPath.replaceAll("\\", "/");
  if (path.includes("/_npx/")) {
    return "npx";
  }
  if (
    path.includes("/pnpm/dlx/") ||
    path.includes("/.pnpm/dlx/") ||
    path.includes("/pnpm-cache/dlx/")
  ) {
    return "pnpm dlx";
  }
  if (path.includes("/.bun/install/cache/") || path.includes("/bunx-")) {
    return "bunx";
  }
  return null;
}

/**
 * The package spec to suggest. The literal spec the user typed is resolved
 * away before our process starts, so re-derive the fork CLI tarball from the
 * running version. Never suggest npm `t3` — that is upstream T3 Code.
 */
export function suggestedPackageSpec(version: string): string {
  return forkCliTarballUrl(version.trim() || undefined);
}

/**
 * Render a `t3 <subcommand>` suggestion that matches how this process was
 * launched, so copy/pasting it actually works: npx suggests
 * `npx --yes --package <tarball> t3 serve`; bunx, pnpm dlx, and global
 * installs suggest `t3 serve` (those runners cannot install an https
 * tarball with npm's `--package` flag).
 */
export function formatCliCommand(input: {
  readonly subcommand: string;
  readonly entryPath: string;
  readonly version: string;
}): string {
  const runner = detectCliRunner(input.entryPath);
  if (runner === "npx") {
    return `npx --yes --package ${suggestedPackageSpec(input.version)} t3 ${input.subcommand}`;
  }
  return `t3 ${input.subcommand}`;
}

/** `formatCliCommand` against this process's real entry path and version. */
export const resolveCliCommand = (subcommand: string) =>
  Effect.map(HostProcessArguments, (processArguments) =>
    formatCliCommand({
      subcommand,
      entryPath: processArguments[1] ?? "",
      version: packageJson.version,
    }),
  );
