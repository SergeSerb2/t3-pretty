import { describe, expect, it } from "vite-plus/test";
import { ENTITY_ID_MAX_LENGTH } from "@t3tools/contracts";

import {
  normalizePullRequestDiffRoutePath,
  normalizePullRequestRouteThreadId,
  parseRoutePositiveInt,
  resolveChangeRequestRoute,
  resolveNativePullRequestTarget,
  resolvePullRequestRouteRepository,
} from "./pullRequestNavigation";

describe("parseRoutePositiveInt", () => {
  it("accepts a linking string or a navigate() number", () => {
    expect(parseRoutePositiveInt("12")).toBe(12);
    expect(parseRoutePositiveInt(12)).toBe(12);
  });

  it("rejects zero, fractions and junk", () => {
    expect(parseRoutePositiveInt("0")).toBeNull();
    expect(parseRoutePositiveInt("1.5")).toBeNull();
    expect(parseRoutePositiveInt("nope")).toBeNull();
    expect(parseRoutePositiveInt(undefined)).toBeNull();
    expect(parseRoutePositiveInt("9".repeat(100_000))).toBeNull();
    expect(parseRoutePositiveInt("1e2")).toBeNull();
  });
});

describe("pull request route text", () => {
  it("rejects empty and oversized file paths and review thread ids", () => {
    const oversized = "x".repeat(ENTITY_ID_MAX_LENGTH + 1);

    expect(normalizePullRequestDiffRoutePath("src/main.ts")).toBe("src/main.ts");
    expect(normalizePullRequestDiffRoutePath(oversized)).toBeNull();
    expect(normalizePullRequestRouteThreadId("thread-1")).toBe("thread-1");
    expect(normalizePullRequestRouteThreadId(oversized)).toBeNull();
  });
});

describe("resolveNativePullRequestTarget", () => {
  it("reads a GitHub URL without needing the project identity", () => {
    expect(
      resolveNativePullRequestTarget({
        environmentId: "env-1",
        projectId: "project-1",
        url: "https://github.com/T3Tools/T3Code/pull/99",
      }),
    ).toEqual({
      environmentId: "env-1",
      projectId: "project-1",
      repository: "t3tools/t3code",
      number: "99",
    });
  });

  it("falls back to the project's repository identity when the URL is not a known host", () => {
    expect(
      resolveNativePullRequestTarget({
        environmentId: "env-1",
        projectId: "project-1",
        url: "https://example.com/change/99",
        number: 99,
        repositoryIdentity: { displayName: "acme/app", owner: "acme", name: "app" },
      }),
    ).toEqual({
      environmentId: "env-1",
      projectId: "project-1",
      repository: "acme/app",
      number: "99",
    });
  });

  it("claims nothing when neither the URL nor the project can name the repository", () => {
    expect(
      resolveNativePullRequestTarget({
        environmentId: "env-1",
        projectId: "project-1",
        url: "https://example.com/change/99",
        number: 99,
      }),
    ).toBeNull();
  });

  it("does not retain oversized navigation inputs", () => {
    const oversized = "x".repeat(ENTITY_ID_MAX_LENGTH + 1);

    expect(
      resolveNativePullRequestTarget({
        environmentId: oversized,
        projectId: "project-1",
        url: "https://github.com/acme/app/pull/1",
      }),
    ).toBeNull();
  });
});

describe("resolvePullRequestRouteRepository", () => {
  it("prefers the navigate extra when it is present", () => {
    expect(
      resolvePullRequestRouteRepository({
        repository: "acme/app",
        environmentId: "env-1",
        projectId: "project-1",
        projects: [],
      }),
    ).toBe("acme/app");
  });

  it("fills in the project's repository identity when the extra is missing", () => {
    expect(
      resolvePullRequestRouteRepository({
        environmentId: "env-1",
        projectId: "project-1",
        projects: [
          {
            environmentId: "env-1",
            id: "project-1",
            repositoryIdentity: { displayName: "acme/app", owner: "acme", name: "app" },
          },
        ],
      }),
    ).toBe("acme/app");
  });

  it("returns null when neither the extra nor the project can name the repository", () => {
    expect(
      resolvePullRequestRouteRepository({
        environmentId: "env-1",
        projectId: "project-1",
        projects: [{ environmentId: "env-1", id: "project-1", repositoryIdentity: null }],
      }),
    ).toBeNull();
  });

  it("rejects oversized route identities and repository names", () => {
    const oversized = "x".repeat(ENTITY_ID_MAX_LENGTH + 1);

    expect(
      resolvePullRequestRouteRepository({
        repository: oversized,
        environmentId: "env-1",
        projectId: "project-1",
        projects: [],
      }),
    ).toBeNull();
    expect(
      resolvePullRequestRouteRepository({
        repository: "acme/app",
        environmentId: oversized,
        projectId: "project-1",
        projects: [],
      }),
    ).toBeNull();
  });
});

describe("resolveChangeRequestRoute", () => {
  const originProject = {
    environmentId: "env-1",
    id: "project-origin",
    repositoryIdentity: {
      canonicalKey: "origin.cursor.com/serbinenko/t3-pretty",
      provider: "origin",
      displayName: "serbinenko/t3-pretty",
      owner: "serbinenko",
      name: "t3-pretty",
    },
  };
  const githubProject = {
    environmentId: "env-1",
    id: "project-1",
    repositoryIdentity: {
      canonicalKey: "github.com/t3tools/t3code",
      provider: "github",
      displayName: "t3tools/t3code",
      owner: "t3tools",
      name: "t3code",
    },
  };

  it("opens a GitHub pull request that matches a workspace project", () => {
    expect(
      resolveChangeRequestRoute({
        environmentId: "env-1",
        url: "https://github.com/T3Tools/T3Code/pull/123",
        pullRequestsSupported: true,
        projects: [githubProject],
      }),
    ).toEqual({
      environmentId: "env-1",
      projectId: "project-1",
      repository: "t3tools/t3code",
      number: "123",
    });
  });

  it("opens an Origin pull request that matches a workspace project", () => {
    expect(
      resolveChangeRequestRoute({
        environmentId: "env-1",
        url: "https://cursor.com/codebase/serbinenko/t3-pretty/pull/35",
        pullRequestsSupported: true,
        projects: [originProject],
      }),
    ).toEqual({
      environmentId: "env-1",
      projectId: "project-origin",
      repository: "serbinenko/t3-pretty",
      number: "35",
    });
  });

  it("leaves the link for the system browser when the environment cannot read pull requests", () => {
    expect(
      resolveChangeRequestRoute({
        environmentId: "env-1",
        url: "https://github.com/T3Tools/T3Code/pull/123",
        pullRequestsSupported: false,
        projects: [githubProject],
      }),
    ).toBeNull();
  });

  it("leaves the link for the system browser when no project matches the repository", () => {
    expect(
      resolveChangeRequestRoute({
        environmentId: "env-1",
        url: "https://github.com/other/repo/pull/1",
        pullRequestsSupported: true,
        projects: [githubProject],
      }),
    ).toBeNull();
  });

  it("does not open a project from another environment", () => {
    expect(
      resolveChangeRequestRoute({
        environmentId: "env-2",
        url: "https://github.com/T3Tools/T3Code/pull/123",
        pullRequestsSupported: true,
        projects: [githubProject],
      }),
    ).toBeNull();
  });

  it("opens the current thread's project when the URL is a pull request and identity is missing", () => {
    expect(
      resolveChangeRequestRoute({
        environmentId: "env-1",
        url: "https://github.com/T3Tools/T3Code/pull/123",
        pullRequestsSupported: true,
        projects: [{ environmentId: "env-1", id: "project-1", repositoryIdentity: null }],
        fallbackProjectId: "project-1",
      }),
    ).toEqual({
      environmentId: "env-1",
      projectId: "project-1",
      repository: "t3tools/t3code",
      number: "123",
    });
  });

  it("does not use the current thread when its identity belongs to a different repository", () => {
    expect(
      resolveChangeRequestRoute({
        environmentId: "env-1",
        url: "https://github.com/other/repo/pull/1",
        pullRequestsSupported: true,
        projects: [githubProject],
        fallbackProjectId: "project-1",
      }),
    ).toBeNull();
  });

  it("prefers a matching project over the current thread when both are present", () => {
    expect(
      resolveChangeRequestRoute({
        environmentId: "env-1",
        url: "https://github.com/T3Tools/T3Code/pull/123",
        pullRequestsSupported: true,
        projects: [
          { environmentId: "env-1", id: "other-project", repositoryIdentity: null },
          githubProject,
        ],
        fallbackProjectId: "other-project",
      }),
    ).toEqual({
      environmentId: "env-1",
      projectId: "project-1",
      repository: "t3tools/t3code",
      number: "123",
    });
  });
});
