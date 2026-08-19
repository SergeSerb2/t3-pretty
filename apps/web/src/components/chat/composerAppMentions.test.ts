import type { AppConnection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { detectComposerTrigger, replaceTextRange } from "~/composer-logic";
import { isAttachableApp, searchAppMentions } from "./composerAppMentions";

function app(overrides: Partial<AppConnection> & Pick<AppConnection, "slug" | "name">) {
  return {
    id: overrides.slug,
    catalogId: overrides.slug,
    url: `https://${overrides.slug}.example/mcp`,
    auth: "oauth",
    scopes: "",
    tokenHeader: "Authorization",
    enabled: true,
    createdAt: 0,
    authorizedAt: 1,
    lastError: null,
    ...overrides,
  } as AppConnection;
}

const gmail = app({ slug: "gmail", name: "Gmail" });
const github = app({ slug: "github", name: "GitHub" });
const linear = app({ slug: "linear", name: "Linear" });

describe("isAttachableApp", () => {
  it("requires enabled plus a credential", () => {
    expect(isAttachableApp(gmail)).toBe(true);
    expect(isAttachableApp(app({ slug: "gmail", name: "Gmail", enabled: false }))).toBe(false);
    expect(isAttachableApp(app({ slug: "gmail", name: "Gmail", authorizedAt: null }))).toBe(false);
  });

  it("treats open servers as attachable without a credential", () => {
    expect(
      isAttachableApp(app({ slug: "docs", name: "Docs", auth: "none", authorizedAt: null })),
    ).toBe(true);
  });
});

describe("searchAppMentions", () => {
  it("lists every app by name when the query is empty", () => {
    expect(searchAppMentions([linear, gmail, github], "").map((entry) => entry.slug)).toEqual([
      "github",
      "gmail",
      "linear",
    ]);
  });

  it("matches name and slug case-insensitively", () => {
    expect(searchAppMentions([gmail, github, linear], "GIT").map((entry) => entry.slug)).toEqual([
      "github",
    ]);
    expect(searchAppMentions([gmail, github, linear], "mai").map((entry) => entry.slug)).toEqual([
      "gmail",
    ]);
  });

  it("ranks prefix matches ahead of substring matches", () => {
    const inbox = app({ slug: "inbox", name: "Inbox by Gmail" });
    expect(searchAppMentions([inbox, gmail], "gmail").map((entry) => entry.slug)).toEqual([
      "gmail",
      "inbox",
    ]);
  });

  it("caps the suggestion count", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      app({ slug: `app${index}`, name: `App ${index}` }),
    );
    expect(searchAppMentions(many, "")).toHaveLength(8);
  });
});

describe("app mention insertion", () => {
  it("replaces the @query token with a bare slug the server can resolve", () => {
    const prompt = "check my @gma";
    const trigger = detectComposerTrigger(prompt, prompt.length);
    expect(trigger).toMatchObject({ kind: "path", query: "gma" });
    const result = replaceTextRange(
      prompt,
      trigger?.rangeStart ?? 0,
      trigger?.rangeEnd ?? 0,
      `@${gmail.slug} `,
    );
    expect(result.text).toBe("check my @gmail ");
    expect(result.cursor).toBe(result.text.length);
  });
});
