import { describe, expect, it } from "vite-plus/test";

import {
  detectSourceControlProviderFromRemoteUrl,
  getChangeRequestTerminologyForKind,
  resolveAutomatedReviewPresentation,
  resolveChangeRequestPresentation,
} from "./sourceControl.ts";

describe("automated review presentation", () => {
  it("keeps an observed no-signal state honest", () => {
    expect(resolveAutomatedReviewPresentation(null)).toEqual({
      label: "No public Codex review signal",
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
          })?.shortLabel,
      ),
    ).toEqual(["Reviewing", "No issues", "Feedback", "Earlier result"]);
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
});
