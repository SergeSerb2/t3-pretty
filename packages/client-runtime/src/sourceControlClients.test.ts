import { describe, expect, it } from "vite-plus/test";

import { sourceControlClients } from "./sourceControlClients.ts";

describe("sourceControlClients", () => {
  it("reads a missing kind as the first host and an unshipped kind as the generic one", () => {
    expect(sourceControlClients.get(undefined).kind).toBe("github");
    expect(sourceControlClients.get("forkhost").kind).toBe("unknown");
  });

  it("gives a change request URL to the first host whose shape it has", () => {
    // GitCafe and Forgejo share `/pulls/`; GitCafe only claims its own hostnames.
    const kindOf = (url: string) => sourceControlClients.findByChangeRequestUrl(url)?.kind;
    expect(kindOf("https://git.cafe/acme/web/pulls/7")).toBe("gitcafe");
    expect(kindOf("https://codeberg.org/acme/web/pulls/7")).toBe("forgejo");
    expect(kindOf("https://cursor.com/codebase/serbinenko/t3-pretty/pull/35")).toBe("origin");
    expect(kindOf("https://github.com/pingdotgg/t3code/pull/1")).toBe("github");
  });

  it("ships Origin so publish and clone pickers keep the fork host", () => {
    expect(sourceControlClients.get("origin").label).toBe("Origin");
    expect(sourceControlClients.get("origin").newRepositoryOwner("serge")).toEqual({
      owner: "serge",
    });
  });
});
