import * as Duration from "effect/Duration";

/**
 * How long GitHub CLI calls for one host stay dark after a 429, given how many
 * times that host has been refused in a row.
 *
 * GitHub's search budget is about 30 requests a minute and its core GraphQL
 * budget is 5,000 points an hour. A refused request costs nothing on their
 * side and returns immediately, so retrying on the next poll — or falling out
 * to one request per repository — spends the rest of the window faster than a
 * healthy caller does. Backing off per host keeps the retry rate below the
 * healthy rate once a host has failed more than once.
 */
export const GITHUB_API_QUOTA_COOLDOWN_BASE = Duration.seconds(30);
export const GITHUB_API_QUOTA_COOLDOWN_MAX = Duration.minutes(15);

export function gitHubApiQuotaCooldown(consecutiveRateLimits: number): Duration.Duration {
  const exponent = Math.max(0, consecutiveRateLimits - 1);
  const backoffMs = Duration.toMillis(GITHUB_API_QUOTA_COOLDOWN_BASE) * Math.pow(2, exponent);
  return Duration.min(Duration.millis(backoffMs), GITHUB_API_QUOTA_COOLDOWN_MAX);
}

/**
 * The GitHub host a `gh` invocation will spend quota on. `--hostname` is the
 * explicit override; `--repo host/owner/name` names an Enterprise install the
 * same way `gh pr list` does. Anything else is github.com, which is what `gh`
 * itself defaults to.
 */
export function gitHubApiHostFromArgs(args: ReadonlyArray<string>): string {
  const hostnameFlag = args.indexOf("--hostname");
  if (hostnameFlag >= 0) {
    const host = args[hostnameFlag + 1]?.trim() ?? "";
    if (host.length > 0) return host.toLowerCase();
  }

  const repoFlag = args.indexOf("--repo");
  if (repoFlag >= 0) {
    const repo = args[repoFlag + 1]?.trim() ?? "";
    const firstSlash = repo.indexOf("/");
    if (firstSlash > 0) {
      const maybeHost = repo.slice(0, firstSlash);
      if (maybeHost.includes(".")) return maybeHost.toLowerCase();
    }
  }

  return "github.com";
}

export interface GitHubApiQuota {
  readonly blockedUntil: (host: string, nowMs: number) => number | null;
  readonly noteSuccess: (host: string) => void;
  readonly noteRateLimit: (host: string, nowMs: number) => Duration.Duration;
}

export function createGitHubApiQuota(): GitHubApiQuota {
  const state = new Map<
    string,
    { readonly cooldownUntilMs: number; readonly consecutive: number }
  >();

  return {
    blockedUntil: (host, nowMs) => {
      const entry = state.get(host);
      if (entry === undefined || nowMs >= entry.cooldownUntilMs) return null;
      return entry.cooldownUntilMs;
    },
    noteSuccess: (host) => {
      state.delete(host);
    },
    noteRateLimit: (host, nowMs) => {
      const consecutive = (state.get(host)?.consecutive ?? 0) + 1;
      const cooldown = gitHubApiQuotaCooldown(consecutive);
      state.set(host, {
        consecutive,
        cooldownUntilMs: nowMs + Duration.toMillis(cooldown),
      });
      return cooldown;
    },
  };
}
