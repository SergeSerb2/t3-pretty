import type {
  AutomatedReviewSignal,
  SourceControlProviderInfo,
  SourceControlProviderKind,
} from "@t3tools/contracts";

export interface AutomatedReviewPresentation {
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
}

export function resolveAutomatedReviewPresentation(
  signal: AutomatedReviewSignal | null | undefined,
): AutomatedReviewPresentation | null {
  if (signal === undefined) return null;
  if (signal === null) {
    return {
      label: "No public auto review signal",
      shortLabel: "No signal",
      description:
        "Smart Review may still be deciding, may have skipped this PR, or Auto Review may be off.",
    };
  }

  switch (signal.state) {
    case "reviewing":
      return {
        label: "Auto review running",
        shortLabel: "Running",
        description: "Codex acknowledged the PR and is reviewing it now.",
      };
    case "passed":
      return {
        label: "Auto review complete",
        shortLabel: "Complete",
        description: "Codex finished and left a thumbs-up instead of review comments.",
      };
    case "feedback":
      return {
        label: "Auto review left feedback",
        shortLabel: "Feedback",
        description: "Codex finished and posted review comments for the current commit.",
      };
    case "stale":
      return {
        label: "Earlier auto review",
        shortLabel: "Earlier",
        description: "The visible Codex result predates the current commit.",
      };
  }
}

export interface ChangeRequestPresentation {
  readonly icon: "github" | "gitlab" | "azure-devops" | "bitbucket" | "origin" | "change-request";
  readonly providerName: string;
  readonly shortName: string;
  readonly longName: string;
  readonly pluralLongName: string;
  readonly providerLongName: string;
  readonly checkoutCommandExample?: string;
  readonly urlExample: string;
}

export interface ChangeRequestTerminology {
  readonly shortLabel: string;
  readonly singular: string;
}

export const DEFAULT_CHANGE_REQUEST_TERMINOLOGY: ChangeRequestTerminology = {
  shortLabel: "PR",
  singular: "pull request",
};

const GITHUB_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "github",
  providerName: "GitHub",
  shortName: "PR",
  longName: "pull request",
  pluralLongName: "pull requests",
  providerLongName: "GitHub pull request",
  checkoutCommandExample: "gh pr checkout 123",
  urlExample: "https://github.com/owner/repo/pull/42",
};

const GITLAB_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "gitlab",
  providerName: "GitLab",
  shortName: "MR",
  longName: "merge request",
  pluralLongName: "merge requests",
  providerLongName: "GitLab merge request",
  checkoutCommandExample: "glab mr checkout 123",
  urlExample: "https://gitlab.com/group/project/-/merge_requests/42",
};

const AZURE_DEVOPS_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "azure-devops",
  providerName: "Azure DevOps",
  shortName: "PR",
  longName: "pull request",
  pluralLongName: "pull requests",
  providerLongName: "Azure DevOps pull request",
  checkoutCommandExample: "az repos pr checkout --id 123",
  urlExample: "https://dev.azure.com/org/project/_git/repo/pullrequest/42",
};

const BITBUCKET_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "bitbucket",
  providerName: "Bitbucket",
  shortName: "PR",
  longName: "pull request",
  pluralLongName: "pull requests",
  providerLongName: "Bitbucket pull request",
  urlExample: "https://bitbucket.org/workspace/repo/pull-requests/42",
};

const ORIGIN_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "origin",
  providerName: "Origin",
  shortName: "PR",
  longName: "pull request",
  pluralLongName: "pull requests",
  providerLongName: "Origin pull request",
  checkoutCommandExample: "origin pr checkout 123",
  urlExample: "https://cursor.com/codebase/owner/repo/pull/42",
};

const GENERIC_CHANGE_REQUEST_PRESENTATION: ChangeRequestPresentation = {
  icon: "change-request",
  providerName: "source control",
  shortName: "change request",
  longName: "change request",
  pluralLongName: "change requests",
  providerLongName: "change request",
  urlExample: "#42",
};

export function resolveChangeRequestPresentation(
  provider: SourceControlProviderInfo | null | undefined,
): ChangeRequestPresentation {
  switch (provider?.kind) {
    case "github":
    case undefined:
      return GITHUB_CHANGE_REQUEST_PRESENTATION;
    case "gitlab":
      return GITLAB_CHANGE_REQUEST_PRESENTATION;
    case "azure-devops":
      return AZURE_DEVOPS_CHANGE_REQUEST_PRESENTATION;
    case "bitbucket":
      return BITBUCKET_CHANGE_REQUEST_PRESENTATION;
    case "origin":
      return ORIGIN_CHANGE_REQUEST_PRESENTATION;
    case "unknown":
    default:
      return GENERIC_CHANGE_REQUEST_PRESENTATION;
  }
}

export function resolveChangeRequestPresentationForKind(
  kind: SourceControlProviderKind,
): ChangeRequestPresentation {
  return resolveChangeRequestPresentation({ kind, name: "", baseUrl: "" });
}

export function formatChangeRequestAction(
  verb: "View" | "Create",
  presentation: ChangeRequestPresentation,
): string {
  return `${verb} ${presentation.shortName}`;
}

export function formatCreateChangeRequestPhrase(presentation: ChangeRequestPresentation): string {
  return `create ${presentation.shortName}`;
}

export function getChangeRequestTerminology(
  provider: SourceControlProviderInfo | null | undefined,
): ChangeRequestTerminology {
  if (!provider) {
    return DEFAULT_CHANGE_REQUEST_TERMINOLOGY;
  }

  const presentation = resolveChangeRequestPresentation(provider);
  return {
    shortLabel: presentation.shortName,
    singular: presentation.longName,
  };
}

export function getChangeRequestTerminologyForKind(
  kind: SourceControlProviderKind,
): ChangeRequestTerminology {
  const presentation = resolveChangeRequestPresentationForKind(kind);
  return {
    shortLabel: presentation.shortName,
    singular: presentation.longName,
  };
}

const SCP_SSH_REMOTE_PATTERN = /^[a-zA-Z0-9._-]+@([^:/]+):/;

export function isSshRemoteUrl(remoteUrl: string): boolean {
  const trimmed = remoteUrl.trim();
  return SCP_SSH_REMOTE_PATTERN.test(trimmed) || trimmed.toLowerCase().startsWith("ssh://");
}

function parseRemoteHost(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // Windows drive paths (c:/repos, c:repos) are not remotes.
  if (/^[a-z]:/i.test(trimmed)) {
    return null;
  }

  const scpMatch = SCP_SSH_REMOTE_PATTERN.exec(trimmed);
  if (scpMatch?.[1]) {
    return scpMatch[1].toLowerCase();
  }

  // Git reserves <transport>::<address> for remote helpers (hg::https://…);
  // the segment before :: is a transport, not a host.
  if (/^[^:/\s]+::/.test(trimmed)) {
    return null;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    try {
      const host = new URL(trimmed).host.toLowerCase();
      return host.length > 0 ? host : null;
    } catch {
      return null;
    }
  }

  // Git documents scp-like syntax as `[<user>@]<host>:<path>` with the user
  // optional and not restricted to `git`, but the host/path separator must be
  // a colon — slash-separated values like alice@github.com/team/repo are
  // filesystem paths. Only the legacy git@host/path form is grandfathered in.
  const scpStyleHost =
    /^(?:[^@:/\s]+@)?([^:/\s]+):/.exec(trimmed) ?? /^git@([^:/\s]+)\//.exec(trimmed);
  const host = scpStyleHost?.[1];
  return host ? host.toLowerCase() : null;
}

function parseHostName(host: string): string {
  try {
    return new URL(`https://${host}`).hostname.toLowerCase();
  } catch {
    return host.replace(/:\d+$/u, "").toLowerCase();
  }
}

function toBaseUrl(host: string): string {
  return `https://${host}`;
}

function hasDnsLabel(host: string, label: string): boolean {
  return host.split(".").includes(label);
}

function isGitHubHost(host: string): boolean {
  return host === "github.com" || hasDnsLabel(host, "github");
}

function isGitLabHost(host: string): boolean {
  return host === "gitlab.com" || hasDnsLabel(host, "gitlab");
}

function isAzureDevOpsHost(host: string): boolean {
  // `ssh.dev.azure.com` is the default Azure DevOps SSH clone host
  // (git@ssh.dev.azure.com:v3/org/project/repo), so match any `*.dev.azure.com`
  // subdomain, not just the bare `dev.azure.com`. Legacy hosts stay under
  // `.visualstudio.com` (including `vs-ssh.visualstudio.com`).
  return (
    host === "dev.azure.com" ||
    host.endsWith(".dev.azure.com") ||
    host.endsWith(".visualstudio.com")
  );
}

function isBitbucketHost(host: string): boolean {
  return host === "bitbucket.org" || hasDnsLabel(host, "bitbucket");
}

function isOriginHost(host: string): boolean {
  // Only the Origin git host. Do not match a DNS label of "origin" — that is
  // the default remote name and would misclassify unrelated forges.
  return host === "origin.cursor.com" || host.endsWith(".origin.cursor.com");
}

/** HTML marker T3 Pretty's Origin Grok review job writes into each comment. */
export const GROK_REVIEW_MARKER = "t3-pretty-grok-review";

export type GrokReviewSeverity = "bug" | "suggestion" | "nit";

/** One finding from `scripts/fork/review-origin-pr.mjs`, not the review summary. */
export interface GrokReviewFinding {
  readonly sha: string | null;
  readonly severity: GrokReviewSeverity;
  readonly title: string;
  readonly path: string | null;
  readonly line: number | null;
  readonly body: string;
}

const GROK_REVIEW_MARKER_PATTERN =
  /<!--\s*t3-pretty-grok-review(?:\s+sha=([0-9a-f]{7,40}))?\s*-->/iu;
const GROK_REVIEW_HEADING_PATTERN = /^###\s+(bug|suggestion|nit)\s+[—–-]\s+(.+)$/mu;
const GROK_REVIEW_SUMMARY_HEADING_PATTERN = /^## Grok [\d.]+ review\b/mu;
const GROK_REVIEW_LOCATION_PATTERN = /^`([^`]+)`$/u;

function parseGrokReviewLocation(raw: string): {
  readonly path: string | null;
  readonly line: number | null;
} {
  const location = raw.trim();
  if (location.length === 0 || location === "general") return { path: null, line: null };
  const split = /^(.*?):(\d+)$/u.exec(location);
  if (split === null) return { path: location, line: null };
  const path = split[1]?.trim() ?? "";
  const line = Number(split[2]);
  return {
    path: path.length > 0 ? path : null,
    line: Number.isInteger(line) && line > 0 ? line : null,
  };
}

export function isGrokReviewComment(body: string): boolean {
  return GROK_REVIEW_MARKER_PATTERN.test(body);
}

/**
 * Structured Grok Origin findings. The review summary uses the same HTML marker but a `##`
 * heading, so it is not a finding.
 */
export function parseGrokReviewFinding(body: string): GrokReviewFinding | null {
  const marker = GROK_REVIEW_MARKER_PATTERN.exec(body);
  if (marker === null) return null;
  const heading = GROK_REVIEW_HEADING_PATTERN.exec(body);
  if (heading === null) return null;
  const severity = heading[1];
  const title = heading[2]?.trim() ?? "";
  if (
    (severity !== "bug" && severity !== "suggestion" && severity !== "nit") ||
    title.length === 0
  ) {
    return null;
  }

  const afterHeading = body.slice((heading.index ?? 0) + heading[0].length);
  const lines = afterHeading.replace(/^\n+/u, "").split("\n");
  const locationLine = GROK_REVIEW_LOCATION_PATTERN.exec(lines[0]?.trim() ?? "");
  const location = parseGrokReviewLocation(locationLine?.[1] ?? "");
  const rest = locationLine === null ? lines : lines.slice(1);
  return {
    sha: marker[1]?.toLowerCase() ?? null,
    severity,
    title,
    path: location.path,
    line: location.line,
    body: rest.join("\n").trim(),
  };
}

/**
 * The bulk write-up posted with each Grok Origin review (`## Grok 4.6 review`). Findings use
 * the same HTML marker and a `###` heading, so they are not summaries.
 */
export function isGrokReviewSummary(body: string): boolean {
  if (GROK_REVIEW_SUMMARY_HEADING_PATTERN.test(body)) return true;
  return isGrokReviewComment(body) && parseGrokReviewFinding(body) === null;
}

export function countGrokReviewSummaries(comments: Iterable<{ readonly body: string }>): number {
  let count = 0;
  for (const comment of comments) {
    if (isGrokReviewSummary(comment.body)) count += 1;
  }
  return count;
}

/** Conversation rows: hide auto-review write-ups unless the reader asked for them. */
export function visiblePullRequestConversationComments<T extends { readonly body: string }>(
  comments: ReadonlyArray<T>,
  includeGrokReviewSummaries: boolean,
): ReadonlyArray<T> {
  if (includeGrokReviewSummaries) return comments;
  return comments.filter((comment) => !isGrokReviewSummary(comment.body));
}

export function firstGrokReviewFinding(bodies: Iterable<string>): GrokReviewFinding | null {
  for (const body of bodies) {
    const finding = parseGrokReviewFinding(body);
    if (finding !== null) return finding;
  }
  return null;
}

export function formatGrokReviewLocation(finding: {
  readonly path: string | null;
  readonly line: number | null;
}): string | null {
  if (finding.path === null) return null;
  return finding.line === null ? finding.path : `${finding.path} · L${finding.line}`;
}

export function detectSourceControlProviderFromRemoteUrl(
  remoteUrl: string,
): SourceControlProviderInfo | null {
  const host = parseRemoteHost(remoteUrl);
  if (!host) {
    return null;
  }
  const hostname = parseHostName(host);

  if (isGitHubHost(hostname)) {
    return {
      kind: "github",
      name: hostname === "github.com" ? "GitHub" : "GitHub Self-Hosted",
      baseUrl: toBaseUrl(host),
    };
  }

  if (isGitLabHost(hostname)) {
    return {
      kind: "gitlab",
      name: hostname === "gitlab.com" ? "GitLab" : "GitLab Self-Hosted",
      baseUrl: toBaseUrl(host),
    };
  }

  if (isAzureDevOpsHost(hostname)) {
    return {
      kind: "azure-devops",
      name: "Azure DevOps",
      baseUrl: toBaseUrl(host),
    };
  }

  if (isBitbucketHost(hostname)) {
    return {
      kind: "bitbucket",
      name: hostname === "bitbucket.org" ? "Bitbucket" : "Bitbucket Self-Hosted",
      baseUrl: toBaseUrl(host),
    };
  }

  if (isOriginHost(hostname)) {
    return {
      kind: "origin",
      name: "Origin",
      baseUrl: toBaseUrl(host),
    };
  }

  return {
    kind: "unknown",
    name: host,
    baseUrl: toBaseUrl(host),
  };
}
