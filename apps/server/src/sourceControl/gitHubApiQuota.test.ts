import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";

import {
  createGitHubApiQuota,
  gitHubApiHostFromArgs,
  gitHubApiQuotaCooldown,
  GITHUB_API_QUOTA_COOLDOWN_BASE,
  GITHUB_API_QUOTA_COOLDOWN_MAX,
} from "./gitHubApiQuota.ts";

describe("gitHubApiHostFromArgs", () => {
  it("defaults to github.com when the invocation names no host", () => {
    expect(gitHubApiHostFromArgs(["api", "user"])).toBe("github.com");
  });

  it("reads --hostname before anything else", () => {
    expect(
      gitHubApiHostFromArgs([
        "api",
        "graphql",
        "--hostname",
        "github.example.com",
        "--repo",
        "github.com/acme/web",
      ]),
    ).toBe("github.example.com");
  });

  it("reads an Enterprise host out of --repo host/owner/name", () => {
    expect(gitHubApiHostFromArgs(["pr", "list", "--repo", "github.example.com/acme/web"])).toBe(
      "github.example.com",
    );
  });

  it("does not treat owner/name as a host", () => {
    expect(gitHubApiHostFromArgs(["pr", "list", "--repo", "acme/web"])).toBe("github.com");
  });
});

describe("gitHubApiQuotaCooldown", () => {
  it("starts at the base delay and doubles per consecutive refusal", () => {
    expect(gitHubApiQuotaCooldown(1)).toEqual(GITHUB_API_QUOTA_COOLDOWN_BASE);
    expect(gitHubApiQuotaCooldown(2)).toEqual(Duration.seconds(60));
    expect(gitHubApiQuotaCooldown(3)).toEqual(Duration.seconds(120));
  });

  it("does not grow past the cap", () => {
    expect(gitHubApiQuotaCooldown(20)).toEqual(GITHUB_API_QUOTA_COOLDOWN_MAX);
  });
});

describe("createGitHubApiQuota", () => {
  it("blocks a host after a 429 and lets another host through", () => {
    const quota = createGitHubApiQuota();
    quota.noteRateLimit("github.com", 1_000);

    expect(quota.blockedUntil("github.com", 1_000)).toBe(
      1_000 + Duration.toMillis(GITHUB_API_QUOTA_COOLDOWN_BASE),
    );
    expect(quota.blockedUntil("github.example.com", 1_000)).toBeNull();
  });

  it("clears a host on the next success", () => {
    const quota = createGitHubApiQuota();
    quota.noteRateLimit("github.com", 1_000);
    quota.noteSuccess("github.com");

    expect(quota.blockedUntil("github.com", 1_000)).toBeNull();
  });

  it("lengthens the dark window on a second refusal", () => {
    const quota = createGitHubApiQuota();
    quota.noteRateLimit("github.com", 1_000);
    const second = quota.noteRateLimit("github.com", 2_000);

    expect(second).toEqual(Duration.seconds(60));
    expect(quota.blockedUntil("github.com", 2_000)).toBe(2_000 + Duration.toMillis(second));
  });

  it("opens the host again once the window has elapsed", () => {
    const quota = createGitHubApiQuota();
    quota.noteRateLimit("github.com", 1_000);

    expect(
      quota.blockedUntil("github.com", 1_000 + Duration.toMillis(GITHUB_API_QUOTA_COOLDOWN_BASE)),
    ).toBeNull();
  });
});
