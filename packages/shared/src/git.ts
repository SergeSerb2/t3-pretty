import type {
  VcsRef,
  SourceControlProviderInfo,
  VcsStatusLocalResult,
  VcsStatusRemoteResult,
  VcsStatusResult,
  VcsStatusStreamEvent,
} from "@t3tools/contracts";
import * as Arr from "effect/Array";
import * as Result from "effect/Result";
import { detectSourceControlProviderFromRemoteUrl } from "./sourceControl.ts";

export const WORKTREE_BRANCH_PREFIX = "t3code";
// Canonical form is `t3code/<8 hex>`. Older mobile builds generated `t3code/<uuid>`
// via Crypto.randomUUID() (always RFC 4122 v4), so the matcher also accepts exactly
// that shape — version nibble `4`, variant nibble `[89ab]` — to keep those threads
// eligible for branch regeneration without loosening beyond what was ever generated.
const TEMP_WORKTREE_BRANCH_PATTERN = new RegExp(
  `^${WORKTREE_BRANCH_PREFIX}\\/(?:[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$`,
);

/**
 * Sanitize an arbitrary string into a valid, lowercase git refName fragment.
 * Strips quotes, collapses separators, limits to 64 chars.
 */
export function sanitizeBranchFragment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/^[./\s_-]+|[./\s_-]+$/g, "");

  const branchFragment = normalized
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  return branchFragment.length > 0 ? branchFragment : "update";
}

/**
 * Sanitize a string into a `feature/…` refName name.
 * Preserves an existing `feature/` prefix or slash-separated namespace.
 */
export function sanitizeFeatureBranchName(raw: string): string {
  const sanitized = sanitizeBranchFragment(raw);
  if (sanitized.includes("/")) {
    return sanitized.startsWith("feature/") ? sanitized : `feature/${sanitized}`;
  }
  return `feature/${sanitized}`;
}

const AUTO_FEATURE_BRANCH_FALLBACK = "feature/update";

/**
 * Resolve a unique `feature/…` refName name that doesn't collide with
 * any existing refName. Appends a numeric suffix when needed.
 */
export function resolveAutoFeatureBranchName(
  existingBranchNames: readonly string[],
  preferredBranch?: string,
): string {
  const preferred = preferredBranch?.trim();
  const resolvedBase = sanitizeFeatureBranchName(
    preferred && preferred.length > 0 ? preferred : AUTO_FEATURE_BRANCH_FALLBACK,
  );
  const existingNames = new Set(existingBranchNames.map((refName) => refName.toLowerCase()));

  if (!existingNames.has(resolvedBase)) {
    return resolvedBase;
  }

  let suffix = 2;
  while (existingNames.has(`${resolvedBase}-${suffix}`)) {
    suffix += 1;
  }

  return `${resolvedBase}-${suffix}`;
}

/**
 * Strip the remote prefix from a remote ref such as `origin/feature/demo`.
 */
export function deriveLocalBranchNameFromRemoteRef(branchName: string): string {
  const firstSeparatorIndex = branchName.indexOf("/");
  if (firstSeparatorIndex <= 0 || firstSeparatorIndex === branchName.length - 1) {
    return branchName;
  }
  return branchName.slice(firstSeparatorIndex + 1);
}

export function buildTemporaryWorktreeBranchName(
  randomHex: (byteLength: number) => string,
): string {
  // Normalize to exactly 8 lowercase hex chars so a UUID-shaped callback
  // still produces the canonical temporary branch form.
  const token = randomHex(4)
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "")
    .slice(0, 8);
  return `${WORKTREE_BRANCH_PREFIX}/${token}`;
}

export function isTemporaryWorktreeBranch(refName: string): boolean {
  return TEMP_WORKTREE_BRANCH_PATTERN.test(refName.trim().toLowerCase());
}

/**
 * Normalize a git remote URL into a stable comparison key.
 */
export function normalizeGitRemoteUrl(value: string): string {
  const normalized = value
    .trim()
    .replace(/\/+$/g, "")
    .replace(/\.git$/i, "")
    .toLowerCase();

  if (/^(?:ssh|https?|git):\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized);
      const repositoryPath = url.pathname
        .split("/")
        .filter((segment) => segment.length > 0)
        .join("/");
      if (url.hostname && repositoryPath.includes("/")) {
        return `${url.hostname}/${repositoryPath}`;
      }
    } catch {
      return normalized;
    }
  }

  // Git documents scp-like syntax as `[<user>@]<host>:<path>` — the username
  // is optional and not restricted to `git` (e.g. github.com:fork/repo or
  // alice@gitlab.company.com:team/repo). Without a username the separator must
  // be a colon and the host must not be a Windows drive letter, otherwise
  // plain and drive-relative paths (c:repos/project) would parse as host/path.
  // <transport>::<address> is reserved for remote helpers, not a host:path.
  const scpStyleHostAndPath =
    /^[a-z]:/i.test(normalized) || /^[^:/\s]+::/.test(normalized)
      ? null
      : (/^(?:[^@:/\s]+@)?([^:/\s]+):([^/\s]+(?:\/[^/\s]+)+)$/i.exec(normalized) ??
        /^[^@:/\s]+@([^:/\s]+)\/([^/\s]+(?:\/[^/\s]+)+)$/i.exec(normalized));
  if (scpStyleHostAndPath?.[1] && scpStyleHostAndPath[2]) {
    return `${scpStyleHostAndPath[1]}/${scpStyleHostAndPath[2]}`;
  }

  return normalized;
}

function parseGitRemoteRepositoryPath(url: string): ReadonlyArray<string> | null {
  const trimmed = url.trim();
  let repositoryPath: string;

  if (/^(?:ssh|https?|git):\/\//i.test(trimmed)) {
    try {
      repositoryPath = new URL(trimmed).pathname;
    } catch {
      return null;
    }
  } else {
    const scpStyleRemote =
      /^[a-z]:/i.test(trimmed) || /^[^:/\s]+::/.test(trimmed)
        ? null
        : (/^(?:[^@:/\s]+@)?[^:/\s]+:(.+)$/u.exec(trimmed) ??
          /^[^@:/\s]+@[^:/\s]+\/(.+)$/u.exec(trimmed));
    repositoryPath = scpStyleRemote?.[1] ?? "";
  }

  const segments = repositoryPath
    .replace(/^\/+|\/+$/gu, "")
    .split("/")
    .filter((segment) => segment.length > 0);
  const repositoryName = segments.at(-1)?.replace(/\.git$/iu, "") ?? "";
  if (segments.length < 2 || repositoryName.length === 0) {
    return null;
  }

  return [...segments.slice(0, -1), repositoryName];
}

/**
 * Best-effort parse of the repository identity used by supported Git hosts.
 * GitHub and Bitbucket use `owner/repo`; GitLab may include nested groups.
 */
export function parseRepositoryNameWithOwnerFromGitRemoteUrl(url: string | null): string | null {
  const trimmed = url?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  const provider = detectSourceControlProviderFromRemoteUrl(trimmed);
  if (
    provider?.kind !== "github" &&
    provider?.kind !== "gitlab" &&
    provider?.kind !== "bitbucket"
  ) {
    return null;
  }

  const segments = parseGitRemoteRepositoryPath(trimmed);
  if (!segments) {
    return null;
  }
  if (provider.kind !== "gitlab" && segments.length !== 2) {
    return null;
  }

  return segments.join("/");
}

/**
 * Best-effort parse of a GitHub `owner/repo` identifier from common remote URL shapes.
 */
export function parseGitHubRepositoryNameWithOwnerFromRemoteUrl(url: string | null): string | null {
  const trimmed = url?.trim() ?? "";
  if (detectSourceControlProviderFromRemoteUrl(trimmed)?.kind !== "github") {
    return null;
  }
  return parseRepositoryNameWithOwnerFromGitRemoteUrl(trimmed);
}

function deriveLocalBranchNameCandidatesFromRemoteRef(
  branchName: string,
  remoteName?: string,
): ReadonlyArray<string> {
  const candidates = new Set<string>();
  const firstSlashCandidate = deriveLocalBranchNameFromRemoteRef(branchName);
  if (firstSlashCandidate.length > 0) {
    candidates.add(firstSlashCandidate);
  }

  if (remoteName) {
    const remotePrefix = `${remoteName}/`;
    if (branchName.startsWith(remotePrefix) && branchName.length > remotePrefix.length) {
      candidates.add(branchName.slice(remotePrefix.length));
    }
  }

  return [...candidates];
}

/**
 * Hide `origin/*` remote refs when a matching local refName already exists.
 */
export function dedupeRemoteBranchesWithLocalMatches(
  refs: ReadonlyArray<VcsRef>,
): ReadonlyArray<VcsRef> {
  const localBranchNames = new Set(
    Arr.filterMap(refs, (refName) =>
      refName.isRemote ? Result.failVoid : Result.succeed(refName.name),
    ),
  );

  return refs.filter((refName) => {
    if (!refName.isRemote) {
      return true;
    }

    if (refName.remoteName !== "origin") {
      return true;
    }

    const localBranchCandidates = deriveLocalBranchNameCandidatesFromRemoteRef(
      refName.name,
      refName.remoteName,
    );
    return !localBranchCandidates.some((candidate) => localBranchNames.has(candidate));
  });
}

export function detectSourceControlProviderFromGitRemoteUrl(
  remoteUrl: string,
): SourceControlProviderInfo | null {
  return detectSourceControlProviderFromRemoteUrl(remoteUrl);
}

const EMPTY_GIT_STATUS_REMOTE: VcsStatusRemoteResult = {
  hasUpstream: false,
  aheadCount: 0,
  behindCount: 0,
  aheadOfDefaultCount: 0,
  pr: null,
};

export function mergeGitStatusParts(
  local: VcsStatusLocalResult,
  remote: VcsStatusRemoteResult | null,
): VcsStatusResult {
  return {
    ...local,
    ...(remote ?? EMPTY_GIT_STATUS_REMOTE),
  };
}

function toRemoteStatusPart(status: VcsStatusResult): VcsStatusRemoteResult {
  return {
    hasUpstream: status.hasUpstream,
    aheadCount: status.aheadCount,
    behindCount: status.behindCount,
    ...(status.aheadOfDefaultCount === undefined
      ? {}
      : { aheadOfDefaultCount: status.aheadOfDefaultCount }),
    pr: status.pr,
  };
}

function toLocalStatusPart(status: VcsStatusResult): VcsStatusLocalResult {
  return {
    isRepo: status.isRepo,
    ...(status.sourceControlProvider
      ? { sourceControlProvider: status.sourceControlProvider }
      : {}),
    hasPrimaryRemote: status.hasPrimaryRemote,
    isDefaultRef: status.isDefaultRef,
    refName: status.refName,
    hasWorkingTreeChanges: status.hasWorkingTreeChanges,
    workingTree: status.workingTree,
  };
}

export function applyGitStatusStreamEvent(
  current: VcsStatusResult | null,
  event: VcsStatusStreamEvent,
): VcsStatusResult {
  switch (event._tag) {
    case "snapshot":
      return mergeGitStatusParts(event.local, event.remote);
    case "localUpdated":
      return mergeGitStatusParts(event.local, current ? toRemoteStatusPart(current) : null);
    case "remoteUpdated":
      if (current === null) {
        return mergeGitStatusParts(
          {
            isRepo: true,
            hasPrimaryRemote: false,
            isDefaultRef: false,
            refName: null,
            hasWorkingTreeChanges: false,
            workingTree: { files: [], insertions: 0, deletions: 0 },
          },
          event.remote,
        );
      }
      return mergeGitStatusParts(toLocalStatusPart(current), event.remote);
  }
}
