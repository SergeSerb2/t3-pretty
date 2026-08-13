import { pullRequestHostOf, type SourceControlProviderKind } from "@t3tools/contracts";

export interface ChangeRequestLink {
  readonly host: string;
  readonly repository: string;
  readonly number: number;
}

export interface ChangeRequestProjectIdentity {
  readonly canonicalKey?: string;
  readonly displayName?: string | null;
  readonly owner?: string | null;
  readonly name?: string | null;
  readonly provider?: string | null;
}

function isHostOf(hostname: string, apex: string, label?: string): boolean {
  if (hostname === apex || hostname.endsWith(`.${apex}`)) return true;
  return label !== undefined && hostname.startsWith(`${label}.`);
}

function claim(host: string, match: RegExpExecArray | null): ChangeRequestLink | null {
  const repository = match?.[1];
  const number = Number(match?.[2]);
  return repository && Number.isSafeInteger(number) && number > 0
    ? { host, repository: repository.toLowerCase(), number }
    : null;
}

/**
 * The repository and number behind a change request URL on a host the page can read, or null
 * for anything else. Null means the system browser.
 */
export function parseChangeRequestUrl(targetUrl: string): ChangeRequestLink | null {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();

  if (isHostOf(host, "github.com", "github")) {
    const match = /^\/([^/]+\/[^/]+)\/pull\/(\d+)(?:\/|$)/u.exec(url.pathname);
    return claim(host, match);
  }
  const gitlab = /^\/([^/]+(?:\/[^/]+)+)\/-\/merge_requests\/(\d+)(?:\/|$)/u.exec(url.pathname);
  if (gitlab) return claim(host, gitlab);
  if (isHostOf(host, "bitbucket.org", "bitbucket")) {
    const match = /^\/([^/]+\/[^/]+)\/pull-requests\/(\d+)(?:\/|$)/u.exec(url.pathname);
    return claim(host, match);
  }
  if (isHostOf(host, "dev.azure.com") || host.endsWith(".visualstudio.com")) {
    const match = /^\/((?:[^/]+\/)*_git\/[^/]+)\/pullrequest\/(\d+)(?:\/|$)/u.exec(url.pathname);
    return claim(host, match);
  }
  return null;
}

export function repositoryFromIdentity(
  identity: {
    readonly displayName?: string | null;
    readonly owner?: string | null;
    readonly name?: string | null;
  } | null,
): string | null {
  if (!identity) return null;
  if (identity.displayName && identity.displayName.trim().length > 0) {
    return identity.displayName.trim();
  }
  if (identity.owner && identity.name) {
    return `${identity.owner}/${identity.name}`;
  }
  return null;
}

/**
 * The project a change-request link belongs to, or nothing. Matched the way the
 * server matches: the repository identity is the full path below the host, and
 * the host is the first segment of the canonical remote.
 *
 * A lookalike hostname matches no project and stays an ordinary link.
 */
export function findProjectForChangeRequest<
  T extends { readonly repositoryIdentity?: ChangeRequestProjectIdentity | null },
>(projects: ReadonlyArray<T>, link: ChangeRequestLink): T | undefined {
  return projects.find((project) => {
    const identity = project.repositoryIdentity;
    if (!identity) return false;
    const kind = identity.provider as SourceControlProviderKind | undefined;
    if (kind === undefined) return false;
    const repository = repositoryFromIdentity(identity);
    return (
      repository !== null &&
      repository.toLowerCase() === link.repository.toLowerCase() &&
      pullRequestHostOf(identity, kind) === link.host.toLowerCase()
    );
  });
}
