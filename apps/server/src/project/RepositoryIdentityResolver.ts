import type { RepositoryIdentity } from "@t3tools/contracts";
import {
  detectSourceControlProviderFromGitRemoteUrl,
  normalizeGitRemoteUrl,
} from "@t3tools/shared/git";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import * as ProcessRunner from "../processRunner.ts";

const DEFAULT_REPOSITORY_IDENTITY_CACHE_CAPACITY = 512;
const DEFAULT_POSITIVE_CACHE_TTL = Duration.minutes(1);
const DEFAULT_NEGATIVE_CACHE_TTL = Duration.minutes(1);

export interface RepositoryIdentityResolverOptions {
  readonly cacheCapacity?: number;
  readonly positiveCacheTtl?: Duration.Input;
  readonly negativeCacheTtl?: Duration.Input;
}

export class RepositoryIdentityResolver extends Context.Service<
  RepositoryIdentityResolver,
  {
    readonly resolve: (cwd: string) => Effect.Effect<RepositoryIdentity | null>;
  }
>()("t3/project/RepositoryIdentityResolver") {}

interface RemoteUrls {
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

// URLs are credential-redacted at parse time so every downstream consumer —
// canonicalKey normalization, display metadata, and the locator — only ever
// sees redacted values.
function parseRemoteUrls(stdout: string): Map<string, RemoteUrls> {
  const remotes = new Map<string, RemoteUrls>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(trimmed);
    if (!match) continue;
    const [, remoteName = "", rawRemoteUrl = "", direction = ""] = match;
    if (remoteName.length === 0 || rawRemoteUrl.length === 0) continue;
    const remoteUrl = redactGitRemoteUrlCredentials(rawRemoteUrl);
    const existing = remotes.get(remoteName) ?? {};
    // A remote can have several push URLs (one `(push)` line each); git treats
    // the first as the primary target, so later lines must not overwrite it.
    if (direction === "fetch" && existing.fetchUrl === undefined) {
      remotes.set(remoteName, { ...existing, fetchUrl: remoteUrl });
    } else if (direction === "push" && existing.pushUrl === undefined) {
      remotes.set(remoteName, { ...existing, pushUrl: remoteUrl });
    }
  }
  return remotes;
}

// A push URL only qualifies as a repository identity when it addresses a real
// host with a repository path — push URLs are also used as write-protection
// sentinels (e.g. `pushurl = DISABLED`, `/dev/null`, `file:///dev/null`),
// which must not leak into the identity. Only URL-shaped values with a
// nonempty hostname and scp-style host:path values qualify; plain filesystem
// paths and bare words are rejected.
function isRepositoryUrl(remoteUrl: string): boolean {
  const trimmed = remoteUrl.trim();
  // Windows drive paths (c:/repos, C://repos, c:\repos) would otherwise parse
  // as single-letter URL schemes or scp hosts.
  if (/^[a-z]:/i.test(trimmed)) {
    return false;
  }
  // <transport>::<address> is reserved for git remote helpers (hg::https://…)
  // and is not a host:path remote.
  if (/^[^:/\s]+::/.test(trimmed)) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.hostname.length === 0) return false;
      return url.pathname.split("/").some((segment) => segment.length > 0);
    } catch {
      return false;
    }
  }
  // Userless drive-letter forms (c:/repos/foo) were already rejected above;
  // with a username present even a one-letter host is an unambiguous SSH
  // alias (git@g:fork/repo.git).
  const scpStyle = /^(?:[^@/\s]+@)?[^:/\s]+:(\S+)$/.exec(trimmed);
  if (!scpStyle) return false;
  const [, path = ""] = scpStyle;
  return path.replace(/^\/+/, "").length > 0;
}

// Remote URLs can embed credentials (e.g. PAT-authenticated HTTPS push URLs,
// or tokens in query parameters such as `?access_token=…`). The identity is
// broadcast to every connected client, so credentials must be stripped before
// a URL is retained. HTTP(S) userinfo is always a credential; for SSH-style
// URLs the username (typically `git`) is part of the address, so only a
// password portion is dropped. Query strings and fragments carry no repository
// address information and are dropped entirely.
function redactGitRemoteUrlCredentials(remoteUrl: string): string {
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(remoteUrl);
  if (schemeMatch) {
    try {
      const url = new URL(remoteUrl);
      if (!url.username && !url.password && !url.search && !url.hash) {
        return remoteUrl;
      }
      url.password = "";
      if (/^https?$/i.test(schemeMatch[1] ?? "")) {
        url.username = "";
      }
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return remoteUrl;
    }
  }
  // scp-style syntax has no password field — everything after the colon is
  // the repository path and must be preserved verbatim.
  return remoteUrl;
}

function pickRemote(
  remotes: ReadonlyMap<string, RemoteUrls>,
  preferredRemoteNames: readonly string[],
  selectUrl: (urls: RemoteUrls) => string | undefined,
): { readonly remoteName: string; readonly remoteUrl: string } | null {
  for (const preferredRemoteName of preferredRemoteNames) {
    const urls = remotes.get(preferredRemoteName);
    const remoteUrl = urls === undefined ? undefined : selectUrl(urls);
    if (remoteUrl) {
      return { remoteName: preferredRemoteName, remoteUrl };
    }
  }

  const sortedRemotes = [...remotes.entries()].toSorted(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [remoteName, urls] of sortedRemotes) {
    const remoteUrl = selectUrl(urls);
    if (remoteName && remoteUrl) {
      return { remoteName, remoteUrl };
    }
  }
  return null;
}

// canonicalKey groups project copies across environments, so it must stay
// stable when the same repository is checked out through different forks —
// prefer the shared upstream's fetch URL. Display fields and the locator
// describe the repository the user actually works against (branches push and
// PRs open on origin), so those prefer origin, and prefer its push URL when it
// differs from the fetch URL (triangular workflows pushing to a fork).
function pickGroupingRemote(remotes: ReadonlyMap<string, RemoteUrls>) {
  return pickRemote(remotes, ["upstream", "origin"], (urls) => urls.fetchUrl);
}

function pickDisplayRemote(remotes: ReadonlyMap<string, RemoteUrls>) {
  // Only remotes with a fetch URL qualify (matching the grouping selection so
  // both roles resolve consistently); a repository push URL then overrides the
  // fetch URL for display.
  return pickRemote(remotes, ["origin", "upstream"], (urls) => {
    if (urls.fetchUrl === undefined) return undefined;
    return urls.pushUrl !== undefined && isRepositoryUrl(urls.pushUrl)
      ? urls.pushUrl
      : urls.fetchUrl;
  });
}

// Derive the repository path (owner/name segments) directly from the URL
// shape rather than from normalizeGitRemoteUrl's output — normalization only
// canonicalizes URLs whose path has an owner/repo pair, so a root-level URL
// like https://git.example/repo.git would otherwise be split as if the scheme
// were the host.
function deriveDisplayRepositoryPathSegments(remoteUrl: string): ReadonlyArray<string> {
  const trimmed = remoteUrl
    .trim()
    .replace(/\/+$/g, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
  // Drive-letter values (c:/repos/project) are filesystem paths, not
  // host/path remotes — skip URL and scp parsing so they use the same
  // normalized-key split as other local paths.
  const isDrivePath = /^[a-z]:/i.test(trimmed);
  if (!isDrivePath) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      try {
        const url = new URL(trimmed);
        // Hostless file: URLs (file:///srv/acme/repo) are filesystem paths —
        // derive metadata from the path like other local remotes.
        if (url.hostname.length === 0 && url.protocol !== "file:") return [];
        return url.pathname.split("/").filter((segment) => segment.length > 0);
      } catch {
        return [];
      }
    }
    const scpStyle = /^[^:/\s]+::/.test(trimmed)
      ? null
      : (/^(?:[^@:/\s]+@)?[^:/\s]+:(.+)$/.exec(trimmed) ?? /^git@[^:/\s]+\/(.+)$/.exec(trimmed));
    if (scpStyle?.[1]) {
      return scpStyle[1].split("/").filter((segment) => segment.length > 0);
    }
  }
  // Filesystem paths: keep the historical normalized-key split.
  return normalizeGitRemoteUrl(trimmed)
    .split("/")
    .slice(1)
    .filter((segment) => segment.length > 0);
}

function buildRepositoryIdentity(input: {
  readonly groupingRemoteUrl: string;
  readonly remoteName: string;
  readonly remoteUrl: string;
  readonly fallbackProviderUrl?: string;
  readonly rootPath: string;
}): RepositoryIdentity {
  const canonicalKey = normalizeGitRemoteUrl(input.groupingRemoteUrl);
  // A promoted push URL can use an unclassifiable host (e.g. an SSH alias);
  // fall back to the fetch URL's recognized provider in that case.
  const displayUrlProvider = detectSourceControlProviderFromGitRemoteUrl(input.remoteUrl);
  const fallbackProvider =
    input.fallbackProviderUrl === undefined
      ? null
      : detectSourceControlProviderFromGitRemoteUrl(input.fallbackProviderUrl);
  const sourceControlProvider =
    displayUrlProvider !== null && displayUrlProvider.kind !== "unknown"
      ? displayUrlProvider
      : fallbackProvider !== null && fallbackProvider.kind !== "unknown"
        ? fallbackProvider
        : (displayUrlProvider ?? fallbackProvider);
  const repositoryPathSegments = deriveDisplayRepositoryPathSegments(input.remoteUrl);
  const repositoryPath = repositoryPathSegments.join("/");
  const owner = repositoryPathSegments.length >= 2 ? repositoryPathSegments[0] : undefined;
  const repositoryName = repositoryPathSegments.at(-1);

  return {
    canonicalKey,
    locator: {
      source: "git-remote",
      remoteName: input.remoteName,
      remoteUrl: input.remoteUrl,
    },
    rootPath: input.rootPath,
    ...(repositoryPath ? { displayName: repositoryPath } : {}),
    ...(sourceControlProvider ? { provider: sourceControlProvider.kind } : {}),
    ...(owner ? { owner } : {}),
    ...(repositoryName ? { name: repositoryName } : {}),
  };
}

const resolveRepositoryIdentityCacheKey = Effect.fn("RepositoryIdentityResolver.resolveCacheKey")(
  function* (cwd: string) {
    const processRunner = yield* ProcessRunner.ProcessRunner;
    let cacheKey = cwd;

    // git is a real executable on every platform — no cmd.exe shell mode, which
    // would split paths containing spaces during cmd's re-tokenization.
    const topLevelResult = yield* processRunner
      .run({
        command: "git",
        args: ["-C", cwd, "rev-parse", "--show-toplevel"],
        timeoutBehavior: "timedOutResult",
      })
      .pipe(Effect.option);
    if (topLevelResult._tag === "None" || topLevelResult.value.code !== 0) {
      return cacheKey;
    }

    const candidate = topLevelResult.value.stdout.trim();
    if (candidate.length > 0) {
      cacheKey = candidate;
    }

    return cacheKey;
  },
);

const resolveRepositoryIdentityFromCacheKey = Effect.fn(
  "RepositoryIdentityResolver.resolveFromCacheKey",
)(function* (
  cacheKey: string,
): Effect.fn.Return<RepositoryIdentity | null, never, ProcessRunner.ProcessRunner> {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const remoteResult = yield* processRunner
    .run({
      command: "git",
      args: ["-C", cacheKey, "remote", "-v"],
      timeoutBehavior: "timedOutResult",
    })
    .pipe(Effect.option);
  if (remoteResult._tag === "None" || remoteResult.value.code !== 0) {
    return null;
  }

  const remotes = parseRemoteUrls(remoteResult.value.stdout);
  const displayRemote = pickDisplayRemote(remotes);
  const groupingRemote = pickGroupingRemote(remotes);
  return displayRemote && groupingRemote
    ? buildRepositoryIdentity({
        ...displayRemote,
        groupingRemoteUrl: groupingRemote.remoteUrl,
        fallbackProviderUrl: remotes.get(displayRemote.remoteName)?.fetchUrl,
        rootPath: cacheKey,
      })
    : null;
});

export const make = Effect.fn("RepositoryIdentityResolver.make")(function* (
  options: RepositoryIdentityResolverOptions = {},
) {
  const processRunner = yield* ProcessRunner.ProcessRunner;

  const repositoryIdentityCache = yield* Cache.makeWith<string, RepositoryIdentity | null>(
    (cacheKey) =>
      resolveRepositoryIdentityFromCacheKey(cacheKey).pipe(
        Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
      ),
    {
      capacity: options.cacheCapacity ?? DEFAULT_REPOSITORY_IDENTITY_CACHE_CAPACITY,
      timeToLive: Exit.match({
        onSuccess: (value) =>
          value === null
            ? (options.negativeCacheTtl ?? DEFAULT_NEGATIVE_CACHE_TTL)
            : (options.positiveCacheTtl ?? DEFAULT_POSITIVE_CACHE_TTL),
        onFailure: () => Duration.zero,
      }),
    },
  );

  const resolve: RepositoryIdentityResolver["Service"]["resolve"] = Effect.fn(
    "RepositoryIdentityResolver.resolve",
  )(function* (cwd) {
    const cacheKey = yield* resolveRepositoryIdentityCacheKey(cwd).pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, processRunner),
    );
    return yield* Cache.get(repositoryIdentityCache, cacheKey);
  });

  return RepositoryIdentityResolver.of({ resolve });
});

export const layer = Layer.effect(RepositoryIdentityResolver, make()).pipe(
  Layer.provide(ProcessRunner.layer),
);
