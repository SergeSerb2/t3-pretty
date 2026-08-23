import { describe, expect, it } from "vite-plus/test";

import {
  connectBrandingForFlavor,
  FORK_CLI_INSTALL_SCRIPT_URL,
  FORK_CLI_TARBALL_FEED_URL,
  forkCliCommand,
  forkCliTarballFileName,
  forkCliTarballUrl,
  SURGE_CONNECT_BRANDING,
  T3_CONNECT_BRANDING,
} from "./connectBranding.ts";

describe("connect branding", () => {
  it("keeps public and internal labels distinct", () => {
    expect(connectBrandingForFlavor("public")).toEqual(T3_CONNECT_BRANDING);
    expect(connectBrandingForFlavor("internal")).toEqual(SURGE_CONNECT_BRANDING);
  });

  it("keeps public and internal CLI release feeds separate", () => {
    expect(forkCliTarballUrl("1.2.3", "public")).toBe(
      "https://github.com/SergeSerb2/t3-pretty/releases/download/public-v1.2.3/t3-1.2.3.tgz",
    );
    expect(forkCliTarballUrl(undefined, "internal")).toBe(
      "https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/t3.tgz",
    );
  });

  it("keeps versioned CLI filenames and commands on the selected fork feed", () => {
    expect(forkCliTarballFileName()).toBe("t3.tgz");
    expect(forkCliTarballFileName("1.2.3")).toBe("t3-1.2.3.tgz");
    expect(forkCliCommand("service update", "1.2.3")).toBe(
      `npx --yes --package ${forkCliTarballUrl("1.2.3")} t3 service update`,
    );
    expect(FORK_CLI_INSTALL_SCRIPT_URL).toBe(`${FORK_CLI_TARBALL_FEED_URL}/install.sh`);
  });
});
