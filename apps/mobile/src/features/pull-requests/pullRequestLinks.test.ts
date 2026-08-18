import { describe, expect, it } from "vite-plus/test";

import {
  findProjectForChangeRequest,
  parseChangeRequestUrl,
  repositoryFromIdentity,
} from "./pullRequestLinks";

describe("parseChangeRequestUrl", () => {
  it("reads a GitHub pull request", () => {
    expect(parseChangeRequestUrl("https://github.com/T3Tools/T3Code/pull/123")).toEqual({
      host: "github.com",
      repository: "t3tools/t3code",
      number: 123,
    });
  });

  it("reads a pull request on a GitHub Enterprise host", () => {
    expect(parseChangeRequestUrl("https://github.acme.test/platform/api/pull/7")).toEqual({
      host: "github.acme.test",
      repository: "platform/api",
      number: 7,
    });
  });

  it("reads a GitLab merge request, nested groups and all", () => {
    expect(
      parseChangeRequestUrl("https://gitlab.com/t3tools/platform/t3code/-/merge_requests/42"),
    ).toEqual({
      host: "gitlab.com",
      repository: "t3tools/platform/t3code",
      number: 42,
    });
  });

  it("reads a Bitbucket pull request", () => {
    expect(parseChangeRequestUrl("https://bitbucket.org/workspace/repo/pull-requests/5")).toEqual({
      host: "bitbucket.org",
      repository: "workspace/repo",
      number: 5,
    });
  });

  it("reads an Origin pull request from the cursor.com web UI", () => {
    expect(
      parseChangeRequestUrl("https://cursor.com/codebase/Serbinenko/T3-Pretty/pull/35"),
    ).toEqual({
      host: "origin.cursor.com",
      repository: "serbinenko/t3-pretty",
      number: 35,
    });
  });

  it("claims nothing it cannot be sure of", () => {
    expect(parseChangeRequestUrl("https://github.com/t3tools/t3code/issues/123")).toBeNull();
    expect(parseChangeRequestUrl("https://example.com/pull/1")).toBeNull();
    expect(parseChangeRequestUrl("https://cursor.com/codebase/pull/35")).toBeNull();
  });
});

describe("repositoryFromIdentity", () => {
  it("prefers displayName, then owner/name", () => {
    expect(repositoryFromIdentity({ displayName: "acme/app", owner: "x", name: "y" })).toBe(
      "acme/app",
    );
    expect(repositoryFromIdentity({ displayName: null, owner: "acme", name: "app" })).toBe(
      "acme/app",
    );
    expect(repositoryFromIdentity(null)).toBeNull();
  });
});

describe("findProjectForChangeRequest", () => {
  const project = (identity: Record<string, unknown>) => ({
    id: "p1",
    repositoryIdentity: identity,
  });

  it("matches a GitHub pull request by host and owner/name", () => {
    const projects = [
      project({
        canonicalKey: "github.com/t3tools/t3code",
        provider: "github",
        owner: "t3tools",
        name: "t3code",
      }),
    ];
    expect(
      findProjectForChangeRequest(projects, {
        host: "github.com",
        repository: "t3tools/t3code",
        number: 123,
      }),
    ).toBe(projects[0]);
  });

  it("matches a nested GitLab group by the whole path below the host", () => {
    const projects = [
      project({
        canonicalKey: "gitlab.com/t3tools/platform/t3code",
        provider: "gitlab",
        displayName: "t3tools/platform/t3code",
        owner: "t3tools",
        name: "t3code",
      }),
    ];
    expect(
      findProjectForChangeRequest(projects, {
        host: "gitlab.com",
        repository: "t3tools/platform/t3code",
        number: 42,
      }),
    ).toBe(projects[0]);
  });

  it("keeps two hosts apart, so an Enterprise link does not open the public one", () => {
    const projects = [
      project({
        canonicalKey: "github.com/pingdotgg/t3code",
        provider: "github",
        owner: "pingdotgg",
        name: "t3code",
      }),
    ];
    expect(
      findProjectForChangeRequest(projects, {
        host: "github.acme.test",
        repository: "pingdotgg/t3code",
        number: 1,
      }),
    ).toBeUndefined();
  });

  it("matches an Origin project by the git host, not the web UI host", () => {
    const projects = [
      project({
        canonicalKey: "origin.cursor.com/serbinenko/t3-pretty",
        provider: "origin",
        displayName: "serbinenko/t3-pretty",
        owner: "serbinenko",
        name: "t3-pretty",
      }),
    ];
    expect(
      findProjectForChangeRequest(projects, {
        host: "origin.cursor.com",
        repository: "serbinenko/t3-pretty",
        number: 35,
      }),
    ).toBe(projects[0]);
    expect(
      findProjectForChangeRequest(projects, {
        host: "cursor.com",
        repository: "serbinenko/t3-pretty",
        number: 35,
      }),
    ).toBeUndefined();
  });

  it("claims nothing for a lookalike host, which is what keeps a link a link", () => {
    const projects = [
      project({
        canonicalKey: "github.com/pingdotgg/t3code",
        provider: "github",
        owner: "pingdotgg",
        name: "t3code",
      }),
    ];
    expect(
      findProjectForChangeRequest(projects, {
        host: "github.com-evil.test",
        repository: "pingdotgg/t3code",
        number: 1,
      }),
    ).toBeUndefined();
  });
});
