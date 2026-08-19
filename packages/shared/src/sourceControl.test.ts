import { describe, expect, it } from "vite-plus/test";

import {
  countGrokReviewSummaries,
  detectSourceControlProviderFromRemoteUrl,
  firstGrokReviewFinding,
  formatGrokReviewLocation,
  getChangeRequestTerminologyForKind,
  isGrokReviewComment,
  isGrokReviewSummary,
  isSshRemoteUrl,
  parseGrokReviewFinding,
  resolveAutomatedReviewPresentation,
  resolveChangeRequestPresentation,
  visiblePullRequestConversationComments,
} from "./sourceControl.ts";

describe("automated review presentation", () => {
  it("keeps an observed no-signal state honest", () => {
    expect(resolveAutomatedReviewPresentation(null)).toEqual({
      label: "No public auto review signal",
      shortLabel: "No signal",
      description:
        "Smart Review may still be deciding, may have skipped this PR, or Auto Review may be off.",
    });
  });

  it("does not invent a state when the server cannot report one", () => {
    expect(resolveAutomatedReviewPresentation(undefined)).toBeNull();
  });

  it("presents each visible Codex lifecycle state", () => {
    expect(
      ["reviewing", "passed", "feedback", "stale"].map(
        (state) =>
          resolveAutomatedReviewPresentation({
            provider: "codex",
            state: state as "reviewing" | "passed" | "feedback" | "stale",
          })?.label,
      ),
    ).toEqual([
      "Auto review running",
      "Auto review complete",
      "Auto review left feedback",
      "Earlier auto review",
    ]);
  });
});

describe("Grok Origin review findings", () => {
  const findingBody = [
    "<!-- t3-pretty-grok-review sha=c2101ed120a579136e59d3757b3905364c66d6dc -->",
    "",
    "### bug — Inline frost loses to nested transparent rule",
    "",
    "`apps/web/src/scenery/scenery.css:943`",
    "",
    "The descendant selector wins.",
    "",
  ].join("\n");

  it("parses a posted finding into severity, title, path, and body", () => {
    expect(parseGrokReviewFinding(findingBody)).toEqual({
      sha: "c2101ed120a579136e59d3757b3905364c66d6dc",
      severity: "bug",
      title: "Inline frost loses to nested transparent rule",
      path: "apps/web/src/scenery/scenery.css",
      line: 943,
      body: "The descendant selector wins.",
    });
    expect(formatGrokReviewLocation({ path: "apps/web/src/scenery/scenery.css", line: 943 })).toBe(
      "apps/web/src/scenery/scenery.css · L943",
    );
  });

  it("does not treat the review summary as a finding", () => {
    const summary = [
      "<!-- t3-pretty-grok-review sha=deadbeef -->",
      "",
      "## Grok 4.6 review",
      "",
      "Looks safe.",
    ].join("\n");
    expect(isGrokReviewComment(summary)).toBe(true);
    expect(isGrokReviewSummary(summary)).toBe(true);
    expect(parseGrokReviewFinding(summary)).toBeNull();
  });

  it("treats a marked comment without a finding heading as a summary", () => {
    expect(isGrokReviewSummary("<!-- t3-pretty-grok-review sha=deadbeef -->\n\nLooks safe.")).toBe(
      true,
    );
  });

  it("recognises the summary heading even if the HTML marker was stripped", () => {
    expect(isGrokReviewSummary("## Grok 4.6 review\n\nLooks safe.")).toBe(true);
  });

  it("does not treat a finding as a summary", () => {
    expect(isGrokReviewSummary(findingBody)).toBe(false);
  });

  it("hides summaries from the conversation unless they are asked for", () => {
    const summary = {
      id: "review",
      body: [
        "<!-- t3-pretty-grok-review sha=deadbeef -->",
        "",
        "## Grok 4.6 review",
        "",
        "Looks safe.",
      ].join("\n"),
    };
    const finding = { id: "finding", body: findingBody };
    const talk = { id: "talk", body: "please also update the docs" };
    const comments = [summary, finding, talk];
    expect(countGrokReviewSummaries(comments)).toBe(1);
    expect(
      visiblePullRequestConversationComments(comments, false).map((comment) => comment.id),
    ).toEqual(["finding", "talk"]);
    expect(visiblePullRequestConversationComments(comments, true)).toEqual(comments);
  });

  it("finds a Grok finding after a reply-only first comment", () => {
    expect(firstGrokReviewFinding(["Fixed the frost.", findingBody])?.path).toBe(
      "apps/web/src/scenery/scenery.css",
    );
  });

  it("ignores ordinary conversation", () => {
    expect(parseGrokReviewFinding("please also update the docs")).toBeNull();
    expect(isGrokReviewComment("please also update the docs")).toBe(false);
    expect(isGrokReviewSummary("please also update the docs")).toBe(false);
  });
});

describe("source control presentation", () => {
  it("uses merge request terminology for GitLab", () => {
    expect(getChangeRequestTerminologyForKind("gitlab")).toEqual({
      shortLabel: "MR",
      singular: "merge request",
    });
  });

  it("uses pull request terminology for GitHub-compatible providers", () => {
    expect(getChangeRequestTerminologyForKind("github")).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
    expect(getChangeRequestTerminologyForKind("azure-devops")).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
    expect(getChangeRequestTerminologyForKind("bitbucket")).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
    expect(getChangeRequestTerminologyForKind("origin")).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
  });

  it("falls back to generic change request copy for unknown providers", () => {
    expect(
      resolveChangeRequestPresentation({ kind: "unknown", name: "forge", baseUrl: "" }),
    ).toEqual(
      expect.objectContaining({
        shortName: "change request",
        longName: "change request",
      }),
    );
  });
});

describe("detectSourceControlProviderFromRemoteUrl", () => {
  it("detects common source control hosts", () => {
    expect(detectSourceControlProviderFromRemoteUrl("git@github.com:owner/repo.git")?.kind).toBe(
      "github",
    );
    expect(
      detectSourceControlProviderFromRemoteUrl("https://gitlab.com/group/repo.git")?.kind,
    ).toBe("gitlab");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://dev.azure.com/org/project/_git/repo")?.kind,
    ).toBe("azure-devops");
    expect(
      detectSourceControlProviderFromRemoteUrl("git@bitbucket.org:workspace/repo.git")?.kind,
    ).toBe("bitbucket");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://origin.cursor.com/owner/repo.git")?.kind,
    ).toBe("origin");
    expect(
      detectSourceControlProviderFromRemoteUrl("git@origin.cursor.com:owner/repo.git")?.kind,
    ).toBe("origin");
  });

  it("returns null for remote-helper URLs", () => {
    expect(detectSourceControlProviderFromRemoteUrl("hg::https://example.com/org/repo")).toBeNull();
  });

  it("returns null for slash-separated non-git user paths", () => {
    expect(detectSourceControlProviderFromRemoteUrl("alice@github.com/team/repo.git")).toBeNull();
  });

  it("classifies scp-style remotes with optional usernames", () => {
    expect(
      detectSourceControlProviderFromRemoteUrl("alice@gitlab.company.com:team/repo.git")?.kind,
    ).toBe("gitlab");
    expect(detectSourceControlProviderFromRemoteUrl("github.com:fork/repo.git")?.kind).toBe(
      "github",
    );
  });

  it("detects Azure DevOps SSH remotes", () => {
    // The default Azure DevOps SSH clone URL uses the ssh.dev.azure.com host.
    expect(
      detectSourceControlProviderFromRemoteUrl("git@ssh.dev.azure.com:v3/org/project/repo")?.kind,
    ).toBe("azure-devops");
    expect(
      detectSourceControlProviderFromRemoteUrl("ssh://git@ssh.dev.azure.com:22/v3/org/project/repo")
        ?.kind,
    ).toBe("azure-devops");
    // Legacy visualstudio.com SSH host stays classified too.
    expect(
      detectSourceControlProviderFromRemoteUrl("git@vs-ssh.visualstudio.com:v3/org/project/repo")
        ?.kind,
    ).toBe("azure-devops");
  });

  it("preserves ports while classifying by hostname", () => {
    expect(
      detectSourceControlProviderFromRemoteUrl("https://gitlab.com:8443/group/repo.git"),
    ).toEqual({
      kind: "gitlab",
      name: "GitLab",
      baseUrl: "https://gitlab.com:8443",
    });
    expect(
      detectSourceControlProviderFromRemoteUrl(
        "https://self-hosted.example.test:8443/group/repo.git",
      ),
    ).toEqual({
      kind: "unknown",
      name: "self-hosted.example.test:8443",
      baseUrl: "https://self-hosted.example.test:8443",
    });
  });

  it("matches self-hosted providers by complete DNS labels", () => {
    expect(
      detectSourceControlProviderFromRemoteUrl("https://github.example.com/owner/repo.git")?.kind,
    ).toBe("github");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://gitlab.example.com/group/repo.git")?.kind,
    ).toBe("gitlab");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://bitbucket.example.com/workspace/repo.git")
        ?.kind,
    ).toBe("bitbucket");
  });

  it("does not match provider names embedded in unrelated DNS labels", () => {
    expect(
      detectSourceControlProviderFromRemoteUrl("https://notgithub.example.com/owner/repo.git")
        ?.kind,
    ).toBe("unknown");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://notgitlab.example.com/group/repo.git")
        ?.kind,
    ).toBe("unknown");
    expect(
      detectSourceControlProviderFromRemoteUrl(
        "https://notbitbucket.example.com/workspace/repo.git",
      )?.kind,
    ).toBe("unknown");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://origin.example.com/owner/repo.git")?.kind,
    ).toBe("unknown");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://notorigin.cursor.com/owner/repo.git")?.kind,
    ).toBe("unknown");
  });

  it("detects SSH remotes with non-git SSH users (e.g. gitlab@, deploy@)", () => {
    expect(
      detectSourceControlProviderFromRemoteUrl("gitlab@gitlab.example.com:group/project.git")?.kind,
    ).toBe("gitlab");
    expect(
      detectSourceControlProviderFromRemoteUrl("gitlab@gitlab.example.com:group/project.git")
        ?.baseUrl,
    ).toBe("https://gitlab.example.com");
    expect(detectSourceControlProviderFromRemoteUrl("deploy@github.com:owner/repo.git")?.kind).toBe(
      "github",
    );
    expect(
      detectSourceControlProviderFromRemoteUrl("git@bitbucket.org:workspace/repo.git")?.kind,
    ).toBe("bitbucket");
  });
});

describe("isSshRemoteUrl", () => {
  it("recognises SCP-like SSH URLs with any SSH user prefix", () => {
    expect(isSshRemoteUrl("git@github.com:owner/repo.git")).toBe(true);
    expect(isSshRemoteUrl("gitlab@gitlab.example.com:group/project.git")).toBe(true);
    expect(isSshRemoteUrl("deploy@bitbucket.org:workspace/repo.git")).toBe(true);
  });

  it("recognises ssh:// URLs with any case", () => {
    expect(isSshRemoteUrl("ssh://git@gitlab.example.com/group/project.git")).toBe(true);
    expect(isSshRemoteUrl("ssh://git@gitlab.example.com:22/group/project.git")).toBe(true);
    expect(isSshRemoteUrl("SSH://git@gitlab.example.com/group/project.git")).toBe(true);
    expect(isSshRemoteUrl("SsH://git@gitlab.example.com/group/project.git")).toBe(true);
  });

  it("returns false for HTTPS, local paths, and SCP-like paths without a colon", () => {
    expect(isSshRemoteUrl("https://gitlab.example.com/group/project.git")).toBe(false);
    expect(isSshRemoteUrl("/home/user/repos/project")).toBe(false);
    expect(isSshRemoteUrl("")).toBe(false);
    expect(isSshRemoteUrl("deploy@github.com/project/repo")).toBe(false);
  });
});
