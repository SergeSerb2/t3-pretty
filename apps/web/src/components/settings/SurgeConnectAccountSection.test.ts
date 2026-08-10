import { describe, expect, it } from "vite-plus/test";

import { resolveSurgeConnectAccountPresentation } from "./SurgeConnectAccountSection";

describe("resolveSurgeConnectAccountPresentation", () => {
  it("keeps the account entry visible while Clerk loads", () => {
    expect(
      resolveSurgeConnectAccountPresentation({
        accountLabel: null,
        isLoaded: false,
        isSignedIn: false,
      }),
    ).toEqual({
      action: "loading",
      actionLabel: "Checking…",
      description: "Checking your Surge Code sign-in status.",
    });
  });

  it("offers a Surge Code sign-in that explains mesh discovery", () => {
    expect(
      resolveSurgeConnectAccountPresentation({
        accountLabel: null,
        isLoaded: true,
        isSignedIn: false,
      }),
    ).toEqual({
      action: "sign-in",
      actionLabel: "Sign in to Surge Code",
      description: "Sign in to discover and connect environments on your Surge Connect mesh.",
    });
  });

  it("shows the active account and a management action after sign-in", () => {
    expect(
      resolveSurgeConnectAccountPresentation({
        accountLabel: "serge@example.com",
        isLoaded: true,
        isSignedIn: true,
      }),
    ).toEqual({
      action: "manage",
      actionLabel: "Manage account",
      description:
        "Signed in as serge@example.com. Environments linked to this account appear below.",
    });
  });
});
