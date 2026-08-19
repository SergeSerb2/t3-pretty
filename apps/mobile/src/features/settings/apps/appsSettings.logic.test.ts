import { AppConnectionId, findAppCatalogEntry, type AppConnection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  appAuthChoices,
  appsCallbackOrigin,
  appCatalogGroups,
  appConnectionInput,
  appConnectionStatus,
  attachableAppMatches,
  catalogConnectionInput,
  isAppAttachable,
  isValidAppSlug,
  normalizeAppSlug,
  requiredOAuthClientFamily,
  uniqueAppSlug,
} from "./appsSettings.logic";

function connection(overrides: Partial<AppConnection> = {}): AppConnection {
  return {
    id: AppConnectionId.make("app-1"),
    catalogId: "gmail",
    name: "Gmail",
    slug: "gmail",
    url: "https://gmailmcp.googleapis.com/mcp/v1",
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

describe("appConnectionInput", () => {
  it("drops the server-owned fields so the record can be sent back", () => {
    expect(appConnectionInput(connection({ authorizedAt: 5, lastError: "boom" }))).toEqual({
      id: "app-1",
      catalogId: "gmail",
      name: "Gmail",
      slug: "gmail",
      url: "https://gmailmcp.googleapis.com/mcp/v1",
      auth: "oauth",
      scopes: "",
      tokenHeader: "Authorization",
      enabled: true,
    });
  });
});

describe("isAppAttachable", () => {
  it("needs both enabled and a credential for authenticated apps", () => {
    expect(isAppAttachable(connection())).toBe(false);
    expect(isAppAttachable(connection({ authorizedAt: 5 }))).toBe(true);
    expect(isAppAttachable(connection({ authorizedAt: 5, enabled: false }))).toBe(false);
  });

  it("treats open servers as attachable once enabled", () => {
    expect(isAppAttachable(connection({ auth: "none", catalogId: "context7" }))).toBe(true);
  });
});

describe("requiredOAuthClientFamily", () => {
  it("reports the family a Google app still needs", () => {
    expect(requiredOAuthClientFamily(connection(), {})).toBe("google");
    expect(
      requiredOAuthClientFamily(connection(), {
        google: { clientId: "id", hasClientSecret: true },
      }),
    ).toBeNull();
  });

  it("ignores apps that register their client dynamically or use a token", () => {
    expect(requiredOAuthClientFamily(connection({ catalogId: "linear" }), {})).toBeNull();
    expect(requiredOAuthClientFamily(connection({ auth: "token" }), {})).toBeNull();
  });
});

describe("appConnectionStatus", () => {
  it("prefers the last error over every other state", () => {
    expect(appConnectionStatus(connection({ authorizedAt: 5, lastError: "401" }), {})).toEqual({
      label: "401",
      tone: "error",
    });
  });

  it("flags a missing OAuth client as setup work", () => {
    expect(appConnectionStatus(connection(), {})).toEqual({
      label: "Needs setup",
      tone: "error",
    });
  });

  it("separates connected, disabled and unconnected records", () => {
    const clients = { google: { clientId: "id", hasClientSecret: true } };
    expect(appConnectionStatus(connection({ authorizedAt: 5 }), clients).label).toBe("Connected");
    expect(
      appConnectionStatus(connection({ authorizedAt: 5, enabled: false }), clients).label,
    ).toBe("Connected · off");
    expect(appConnectionStatus(connection(), clients).label).toBe("Not connected");
  });
});

describe("normalizeAppSlug", () => {
  it("lowercases, replaces invalid runs and trims the edges", () => {
    expect(normalizeAppSlug("My Cool Server")).toBe("my-cool-server");
    expect(normalizeAppSlug("  --Weird!! ")).toBe("weird");
    expect(normalizeAppSlug("2fa")).toBe("2fa");
  });

  it("caps the slug at the contract's 32 characters", () => {
    expect(normalizeAppSlug("a".repeat(50))).toHaveLength(32);
    expect(isValidAppSlug(normalizeAppSlug("a".repeat(50)))).toBe(true);
  });
});

describe("uniqueAppSlug", () => {
  it("suffixes until the slug is free", () => {
    expect(uniqueAppSlug("gmail", [])).toBe("gmail");
    expect(uniqueAppSlug("gmail", ["gmail"])).toBe("gmail-2");
    expect(uniqueAppSlug("gmail", ["gmail", "gmail-2"])).toBe("gmail-3");
  });

  it("keeps suffixed slugs inside the length limit", () => {
    const base = "a".repeat(32);
    const slug = uniqueAppSlug(base, [base]);
    expect(slug).toBe(`${"a".repeat(30)}-2`);
    expect(isValidAppSlug(slug)).toBe(true);
  });

  it("falls back to a usable slug when the name has nothing to keep", () => {
    expect(uniqueAppSlug("!!!", [])).toBe("app");
  });
});

describe("appAuthChoices", () => {
  it("offers both paths when the catalog supports a token as well", () => {
    const github = findAppCatalogEntry("github");
    expect(github && appAuthChoices(github)).toEqual({ oauth: true, token: true });
  });

  it("offers only what the entry supports", () => {
    const zapier = findAppCatalogEntry("zapier");
    expect(zapier && appAuthChoices(zapier)).toEqual({ oauth: false, token: true });
    const context7 = findAppCatalogEntry("context7");
    expect(context7 && appAuthChoices(context7)).toEqual({ oauth: false, token: false });
  });
});

describe("catalogConnectionInput", () => {
  it("builds an enabled record with a unique slug and the catalog defaults", () => {
    const entry = findAppCatalogEntry("gmail");
    if (!entry) throw new Error("gmail missing from the catalog");
    expect(
      catalogConnectionInput({
        id: AppConnectionId.make("app-2"),
        entry,
        auth: "oauth",
        takenSlugs: ["gmail"],
      }),
    ).toEqual({
      id: "app-2",
      catalogId: "gmail",
      name: "Gmail",
      slug: "gmail-2",
      url: entry.url,
      auth: "oauth",
      scopes: entry.scopes,
      tokenHeader: "Authorization",
      enabled: true,
    });
  });

  it("drops OAuth scopes when the user connects with a token", () => {
    const entry = findAppCatalogEntry("github");
    if (!entry) throw new Error("github missing from the catalog");
    expect(
      catalogConnectionInput({
        id: AppConnectionId.make("app-3"),
        entry,
        auth: "token",
        takenSlugs: [],
      }).scopes,
    ).toBe("");
  });
});

describe("appCatalogGroups", () => {
  it("groups every entry in category order and skips empty categories", () => {
    const groups = appCatalogGroups("");
    expect(groups[0]?.category).toBe("personal");
    expect(groups.every((group) => group.entries.length > 0)).toBe(true);
    expect(groups.flatMap((group) => group.entries)).toHaveLength(
      appCatalogGroups("").reduce((total, group) => total + group.entries.length, 0),
    );
  });

  it("matches name, id and description", () => {
    expect(
      appCatalogGroups("gmail")
        .flatMap((group) => group.entries)
        .map((e) => e.id),
    ).toEqual(["gmail"]);
    expect(
      appCatalogGroups("merge requests")
        .flatMap((group) => group.entries)
        .map((e) => e.id),
    ).toEqual(["gitlab"]);
    expect(appCatalogGroups("no-such-app")).toEqual([]);
  });
});

describe("attachableAppMatches", () => {
  const apps = {
    connections: {
      a: connection({
        id: AppConnectionId.make("a"),
        name: "Gmail",
        slug: "gmail",
        authorizedAt: 1,
      }),
      b: connection({
        id: AppConnectionId.make("b"),
        name: "Linear",
        slug: "linear",
        catalogId: "linear",
        authorizedAt: 1,
      }),
      c: connection({ id: AppConnectionId.make("c"), name: "Asana", slug: "asana" }),
    },
    oauthClients: {},
  };

  it("returns attachable apps sorted by name for an empty query", () => {
    expect(attachableAppMatches(apps, "", 8).map((app) => app.slug)).toEqual(["gmail", "linear"]);
  });

  it("matches slug or name and honours the limit", () => {
    expect(attachableAppMatches(apps, "lin", 8).map((app) => app.slug)).toEqual(["linear"]);
    expect(attachableAppMatches(apps, "@gm", 8).map((app) => app.slug)).toEqual(["gmail"]);
    expect(attachableAppMatches(apps, "", 1)).toHaveLength(1);
  });
});

describe("appsCallbackOrigin", () => {
  it("reduces the client's base URL to an origin", () => {
    expect(appsCallbackOrigin("http://192.168.1.10:3773/api/")).toBe("http://192.168.1.10:3773");
    expect(appsCallbackOrigin("https://box.ts.net")).toBe("https://box.ts.net");
  });

  it("returns null when there is nothing usable to build a redirect from", () => {
    expect(appsCallbackOrigin(undefined)).toBeNull();
    expect(appsCallbackOrigin("")).toBeNull();
    expect(appsCallbackOrigin("not a url")).toBeNull();
  });
});
