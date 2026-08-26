import {
  DESKTOP_SSH_ALIAS_MAX_LENGTH,
  DESKTOP_SSH_DESTINATION_MAX_LENGTH,
  type DesktopDiscoveredSshHost,
} from "@t3tools/contracts";

import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { SshHostDiscoveryError } from "./errors.ts";

const NO_HOSTS: ReadonlyArray<string> = [] as const;
const SSH_CONFIG_FILE_MAX_BYTES = 1024 * 1024;
const SSH_KNOWN_HOSTS_FILE_MAX_BYTES = 8 * 1024 * 1024;
const SSH_CONFIG_VISITED_FILE_MAX_COUNT = 256;
const SSH_CONFIG_GLOB_MATCH_MAX_COUNT = 256;
export const SSH_DISCOVERED_HOST_MAX_COUNT = 4_096;
const SSH_FILE_READ_CHUNK_BYTES = 64 * 1024;

export const readSshFileStringWithinLimit = Effect.fnUntraced(function* (
  filePath: string,
  maxBytes: number,
) {
  const fs = yield* FileSystem.FileSystem;
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* fs.open(filePath, { flag: "r" });
      const info = yield* handle.stat;
      if (info.size > BigInt(maxBytes)) return Option.none<string>();

      const initial = new Uint8Array(Number(info.size));
      let totalBytes = 0;
      while (totalBytes < initial.length) {
        const bytesRead = Number(yield* handle.read(initial.subarray(totalBytes)));
        if (bytesRead === 0) break;
        totalBytes += bytesRead;
      }
      if (totalBytes < initial.length) {
        return Option.some(new TextDecoder().decode(initial.subarray(0, totalBytes)));
      }

      const chunks: Uint8Array[] = initial.length === 0 ? [] : [initial];
      const readCeiling = maxBytes + 1;
      while (totalBytes < readCeiling) {
        const chunk = yield* handle.readAlloc(
          Math.min(SSH_FILE_READ_CHUNK_BYTES, readCeiling - totalBytes),
        );
        if (Option.isNone(chunk)) break;
        chunks.push(chunk.value);
        totalBytes += chunk.value.byteLength;
      }
      if (totalBytes > maxBytes) return Option.none<string>();
      if (chunks.length === 0) return Option.some("");
      if (chunks.length === 1) return Option.some(new TextDecoder().decode(chunks[0]!));

      const bytes = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return Option.some(new TextDecoder().decode(bytes));
    }),
  );
});

function stripInlineComment(line: string): string {
  const hashIndex = line.indexOf("#");
  return (hashIndex >= 0 ? line.slice(0, hashIndex) : line).trim();
}

function splitDirectiveArgs(value: string): ReadonlyArray<string> {
  const args: Array<string> = [];
  for (const rawEntry of value
    .replace(/=(?!=)/gu, " ")
    .trim()
    .split(/\s+/u)) {
    const entry = rawEntry.trim();
    if (entry.length > 0) {
      args.push(entry);
    }
  }
  return args;
}

function expandHomePath(input: string, homeDir: string): string {
  return input.replace(/^~(?=$|\/|\\)/u, homeDir);
}

export const resolveSshConfigIncludePattern = Effect.fnUntraced(function* (
  includePattern: string,
  _directory: string,
  homeDir: string,
) {
  const path = yield* Path.Path;
  const expandedPattern = expandHomePath(includePattern, homeDir);
  return path.isAbsolute(expandedPattern)
    ? expandedPattern
    : path.resolve(path.join(homeDir, ".ssh"), expandedPattern);
});

function hasSshPattern(value: string): boolean {
  return value.includes("*") || value.includes("?") || value.startsWith("!");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
  return new RegExp(
    `^${escapeRegex(pattern).replace(/\\\*/gu, ".*").replace(/\\\?/gu, ".")}$`,
    "u",
  );
}

const expandGlob = Effect.fnUntraced(function* (pattern: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  if (!pattern.includes("*") && !pattern.includes("?")) {
    return (yield* fs.exists(pattern)) ? [pattern] : NO_HOSTS;
  }

  const directory = path.dirname(pattern);
  const basePattern = path.basename(pattern);
  if (!(yield* fs.exists(directory))) {
    return NO_HOSTS;
  }

  const matcher = globToRegExp(basePattern);
  const entries = yield* fs.readDirectory(directory);
  const matchedPaths: string[] = [];
  for (const entry of entries) {
    if (!matcher.test(entry)) {
      continue;
    }
    const entryPath = path.join(directory, entry);
    if (yield* fs.exists(entryPath)) {
      matchedPaths.push(entryPath);
      if (matchedPaths.length >= SSH_CONFIG_GLOB_MATCH_MAX_COUNT) break;
    }
  }
  return matchedPaths.toSorted((left, right) => left.localeCompare(right));
});

export const collectSshConfigAliasesFromFile = Effect.fnUntraced(function* (
  filePath: string,
  visited = new Set<string>(),
  homeDir: string,
): Effect.fn.Return<
  ReadonlyArray<string>,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolvedPath = path.resolve(filePath);
  if (
    visited.has(resolvedPath) ||
    visited.size >= SSH_CONFIG_VISITED_FILE_MAX_COUNT ||
    !(yield* fs.exists(resolvedPath))
  ) {
    return NO_HOSTS;
  }
  visited.add(resolvedPath);

  const aliases = new Set<string>();
  const directory = path.dirname(resolvedPath);
  const raw = yield* readSshFileStringWithinLimit(resolvedPath, SSH_CONFIG_FILE_MAX_BYTES);
  if (Option.isNone(raw)) return NO_HOSTS;

  for (const line of raw.value.split(/\r?\n/u)) {
    if (aliases.size >= SSH_DISCOVERED_HOST_MAX_COUNT) break;
    const stripped = stripInlineComment(line);
    if (stripped.length === 0) {
      continue;
    }

    const [directive = "", ...rawArgs] = splitDirectiveArgs(stripped);
    const normalizedDirective = directive.toLowerCase();
    if (normalizedDirective === "include") {
      for (const includePattern of rawArgs) {
        const resolvedPattern = yield* resolveSshConfigIncludePattern(
          includePattern,
          directory,
          homeDir,
        );
        const includedPaths = yield* expandGlob(resolvedPattern);
        for (const includedPath of includedPaths) {
          const includedAliases = yield* collectSshConfigAliasesFromFile(
            includedPath,
            visited,
            homeDir,
          );
          for (const alias of includedAliases) {
            aliases.add(alias);
            if (aliases.size >= SSH_DISCOVERED_HOST_MAX_COUNT) break;
          }
        }
      }
      continue;
    }

    if (normalizedDirective !== "host") {
      continue;
    }

    for (const alias of rawArgs) {
      if (alias.length === 0 || hasSshPattern(alias)) {
        continue;
      }
      if (alias.length <= DESKTOP_SSH_ALIAS_MAX_LENGTH) aliases.add(alias);
      if (aliases.size >= SSH_DISCOVERED_HOST_MAX_COUNT) break;
    }
  }

  return [...aliases].toSorted((left, right) => left.localeCompare(right));
});

function normalizeKnownHostsHostname(rawHost: string): string {
  const bracketMatch = /^\[([^\]]+)\]:(\d+)$/u.exec(rawHost);
  if (bracketMatch?.[1]) {
    return bracketMatch[1];
  }

  if (!rawHost.includes(":")) {
    return rawHost;
  }

  const firstColonIndex = rawHost.indexOf(":");
  const lastColonIndex = rawHost.lastIndexOf(":");
  return firstColonIndex === lastColonIndex ? rawHost.slice(0, lastColonIndex) : rawHost;
}

export function parseKnownHostsHostnames(raw: string): ReadonlyArray<string> {
  const hostnames = new Set<string>();

  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    const withoutMarker = trimmed.startsWith("@")
      ? trimmed.split(/\s+/u).slice(1).join(" ")
      : trimmed;
    const [hostField = ""] = withoutMarker.split(/\s+/u);
    if (hostField.length === 0 || hostField.startsWith("|")) {
      continue;
    }

    for (const rawHost of hostField.split(",")) {
      const host = normalizeKnownHostsHostname(rawHost).trim();
      if (
        host.length === 0 ||
        host.length > DESKTOP_SSH_DESTINATION_MAX_LENGTH ||
        hasSshPattern(host)
      ) {
        continue;
      }
      hostnames.add(host);
      if (hostnames.size >= SSH_DISCOVERED_HOST_MAX_COUNT) {
        return [...hostnames].toSorted((left, right) => left.localeCompare(right));
      }
    }
  }

  return [...hostnames].toSorted((left, right) => left.localeCompare(right));
}

const readKnownHostsHostnames = Effect.fnUntraced(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(filePath))) {
    return NO_HOSTS;
  }
  const raw = yield* readSshFileStringWithinLimit(filePath, SSH_KNOWN_HOSTS_FILE_MAX_BYTES);
  return Option.isSome(raw) ? parseKnownHostsHostnames(raw.value) : NO_HOSTS;
});

export const discoverSshHosts = Effect.fnUntraced(
  function* (input: { readonly homeDir?: string }) {
    const path = yield* Path.Path;
    const env = yield* Config.all({
      home: Config.string("HOME").pipe(Config.option),
      userProfile: Config.string("USERPROFILE").pipe(Config.option),
    });
    const homeDir =
      input?.homeDir ??
      Option.getOrUndefined(env.home) ??
      Option.getOrUndefined(env.userProfile) ??
      "";
    if (homeDir.trim().length === 0) {
      return [];
    }

    const sshDirectory = path.join(homeDir, ".ssh");
    const configAliases = yield* collectSshConfigAliasesFromFile(
      path.join(sshDirectory, "config"),
      new Set<string>(),
      homeDir,
    );
    const knownHosts = yield* readKnownHostsHostnames(path.join(sshDirectory, "known_hosts"));
    const discovered = new Map<string, DesktopDiscoveredSshHost>();

    for (const alias of configAliases) {
      discovered.set(alias, {
        alias,
        hostname: alias,
        username: null,
        port: null,
        source: "ssh-config",
      });
      if (discovered.size >= SSH_DISCOVERED_HOST_MAX_COUNT) break;
    }

    for (const hostname of knownHosts) {
      if (discovered.size >= SSH_DISCOVERED_HOST_MAX_COUNT) break;
      if (discovered.has(hostname)) {
        continue;
      }
      discovered.set(hostname, {
        alias: hostname,
        hostname,
        username: null,
        port: null,
        source: "known-hosts",
      });
    }

    return [...discovered.values()].toSorted((left, right) =>
      left.alias.localeCompare(right.alias),
    );
  },
  Effect.mapError(
    (cause) =>
      new SshHostDiscoveryError({
        message: "Failed to discover SSH hosts.",
        cause,
      }),
  ),
);
