import { describe, expect, it } from "vite-plus/test";
import {
  AppConnectionId,
  findAppCatalogEntry,
  type AppCatalogEntry,
  type AppConnection,
} from "@t3tools/contracts";

import {
  appAuthHint,
  appConnectionInput,
  appConnectionStatus,
  appDraftError,
  appsRedirectUri,
  catalogConnectionInput,
  connectedCatalogIds,
  deriveAppSlug,
  filterAppCatalog,
  sortedAppConnections,
  uniqueAppSlug,
} from "./AppsSettings.logic";

const gmail = findAppCatalogEntry("gmail") as AppCatalogEntry;
const context7 = findAppCatalogEntry("context7") as AppCatalogEntry;
const github = findAppCatalogEntry("github") as AppCatalogEntry;

function connection(overrides: Partial<AppConnection> = {}): AppConnection {
  return {
    id: AppConnectionId.make("conn-gmail"),
    catalogId: "gmail",
    name: "Gmail",
    slug: "gmail",
    url: gmail.url,
    auth: "oauth",
    scopes: "",
    tokenHeader: "Authorization",
    enabled: true,
    createdAt: 1,
    authorizedAt: null,
    lastError: null,
    ...overrides,
  };
}

describe("deriveAppSlug", () => {
  it("lowercases and dashes a display name", () => {
    expect(deriveAppSlug("Atlassian (Jira & Confluence)")).toBe("atlassian-jira-confluence");
    expect(deriveAppSlug("monday.com")).toBe("monday-com");
  });

  it("drops leading punctuation so the slug starts with a letter or number", () => {
    expect(deriveAppSlug("__internal tool")).toBe("internal-tool");
    expect(deriveAppSlug("!!!")).toBe("");
  });

  it("truncates to the 32-character limit", () => {
    expect(deriveAppSlug("a".repeat(40))).toHaveLength(32);
  });
});

describe("uniqueAppSlug", () => {
  it("returns the derived slug when it is free", () => {
    expect(uniqueAppSlug("Linear", new Set())).toBe("linear");
  });

  it("suffixes until the slug is free", () => {
    expect(uniqueAppSlug("Linear", ["linear", "linear-2"])).toBe("linear-3");
  });

  it("keeps suffixed slugs inside the length limit", () => {
    const slug = uniqueAppSlug("a".repeat(40), ["a".repeat(32)]);
    expect(slug).toHaveLength(32);
    expect(slug.endsWith("-2")).toBe(true);
  });

  it("falls back to a usable slug when the name has nothing to keep", () => {
    expect(uniqueAppSlug("***", new Set())).toBe("app");
  });
});

describe("appConnectionStatus", () => {
  it("treats open servers as connected", () => {
    expect(appConnectionStatus(connection({ auth: "none" }), {})).toBe("connected");
  });

  it("is connected once a credential is stored", () => {
    expect(appConnectionStatus(connection({ authorizedAt: 5 }), {})).toBe("connected");
  });

  it("asks for the OAuth client when its family is unconfigured", () => {
    expect(appConnectionStatus(connection(), {})).toBe("needs-oauth-client");
    expect(
      appConnectionStatus(connection(), { google: { clientId: "id", hasClientSecret: true } }),
    ).toBe("disconnected");
  });

  it("does not ask for a client when the app authorizes with a token", () => {
    expect(appConnectionStatus(connection({ auth: "token" }), {})).toBe("disconnected");
  });
});

describe("appConnectionInput", () => {
  it("keeps only the client-writable fields", () => {
    expect(appConnectionInput(connection({ authorizedAt: 5, lastError: "boom" }))).toEqual({
      id: "conn-gmail",
      catalogId: "gmail",
      name: "Gmail",
      slug: "gmail",
      url: gmail.url,
      auth: "oauth",
      scopes: "",
      tokenHeader: "Authorization",
      enabled: true,
    });
  });
});

describe("catalogConnectionInput", () => {
  it("seeds catalog defaults and a free slug", () => {
    const input = catalogConnectionInput(
      gmail,
      ["gmail"],
      "oauth",
      AppConnectionId.make("conn-new"),
    );
    expect(input).toMatchObject({
      catalogId: "gmail",
      name: "Gmail",
      slug: "gmail-2",
      auth: "oauth",
      scopes: gmail.scopes,
      tokenHeader: "Authorization",
      enabled: true,
    });
  });

  it("honours the chosen auth kind for token-capable apps", () => {
    const input = catalogConnectionInput(github, [], "token", AppConnectionId.make("conn-gh"));
    expect(input.auth).toBe("token");
  });
});

describe("appDraftError", () => {
  const draft = {
    name: "Acme",
    slug: "acme",
    url: "https://mcp.acme.test/mcp",
    auth: "oauth" as const,
    scopes: "",
    tokenHeader: "Authorization",
  };

  it("accepts a complete draft", () => {
    expect(appDraftError(draft, new Set())).toBeNull();
  });

  it("rejects a missing name and an over-long one", () => {
    expect(appDraftError({ ...draft, name: "  " }, new Set())).toMatch(/Name is required/);
    expect(appDraftError({ ...draft, name: "n".repeat(65) }, new Set())).toMatch(/64 characters/);
  });

  it("rejects slugs the schema would reject and slugs already in use", () => {
    expect(appDraftError({ ...draft, slug: "Acme" }, new Set())).toMatch(/Slug must start/);
    expect(appDraftError(draft, new Set(["acme"]))).toMatch(/already uses "@acme"/);
  });

  it("requires an https URL", () => {
    expect(appDraftError({ ...draft, url: "" }, new Set())).toMatch(/URL is required/);
    expect(appDraftError({ ...draft, url: "http://mcp.acme.test" }, new Set())).toMatch(/https/);
    expect(appDraftError({ ...draft, url: "not a url" }, new Set())).toMatch(/https/);
  });

  it("requires a header for token auth", () => {
    expect(appDraftError({ ...draft, auth: "token", tokenHeader: " " }, new Set())).toMatch(
      /Token header/,
    );
  });
});

describe("filterAppCatalog", () => {
  it("filters by category", () => {
    const knowledge = filterAppCatalog("", "knowledge");
    expect(knowledge.length).toBeGreaterThan(0);
    expect(knowledge.every((entry) => entry.category === "knowledge")).toBe(true);
  });

  it("matches name, description, id and category label", () => {
    expect(filterAppCatalog("gmail", "all").map((entry) => entry.id)).toEqual(["gmail"]);
    expect(filterAppCatalog("pull requests", "all").map((entry) => entry.id)).toContain("github");
    expect(filterAppCatalog("google-calendar", "all").map((entry) => entry.id)).toEqual([
      "google-calendar",
    ]);
    expect(
      filterAppCatalog("payments", "all").every((entry) => entry.category === "payments"),
    ).toBe(true);
  });

  it("intersects query and category", () => {
    expect(filterAppCatalog("gmail", "payments")).toEqual([]);
  });
});

describe("appAuthHint", () => {
  it("names the missing OAuth client family", () => {
    expect(appAuthHint(gmail, {})).toBe("Needs Google Cloud OAuth client");
    expect(appAuthHint(gmail, { google: { clientId: "id", hasClientSecret: true } })).toBe("OAuth");
  });

  it("labels token and open servers", () => {
    expect(appAuthHint(context7, {})).toBe("No sign-in");
    // Render defaults to token auth even though it also has an OAuth family.
    expect(appAuthHint(findAppCatalogEntry("render") as AppCatalogEntry, {})).toBe("API token");
  });
});

describe("sortedAppConnections and connectedCatalogIds", () => {
  it("sorts by name and collects catalog ids", () => {
    const connections = {
      b: connection({ id: AppConnectionId.make("b"), name: "Zulip", catalogId: null }),
      a: connection({ id: AppConnectionId.make("a"), name: "Gmail" }),
    };
    expect(sortedAppConnections(connections).map((entry) => entry.name)).toEqual([
      "Gmail",
      "Zulip",
    ]);
    expect([...connectedCatalogIds(connections)]).toEqual(["gmail"]);
  });
});

describe("appsRedirectUri", () => {
  it("points at the server's callback route", () => {
    expect(appsRedirectUri("https://t3.example.com")).toBe(
      "https://t3.example.com/api/apps/oauth/callback",
    );
  });
});
