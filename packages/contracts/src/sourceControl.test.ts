import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";

import {
  SOURCE_CONTROL_DISCOVERY_PROVIDER_MAX_COUNT,
  SOURCE_CONTROL_DISCOVERY_VCS_MAX_COUNT,
  SourceControlDiscoveryResult,
} from "./sourceControl.ts";

const decodeDiscovery = Schema.decodeUnknownSync(SourceControlDiscoveryResult);

const vcs = {
  kind: "git" as const,
  implemented: true,
  label: "Git",
  executable: "git",
  status: "available" as const,
  version: Option.some("git version 2.50"),
  installHint: "Install Git.",
  detail: Option.none<string>(),
};

const provider = {
  kind: "github" as const,
  label: "GitHub",
  executable: "gh",
  status: "available" as const,
  version: Option.some("gh version 2.80"),
  installHint: "Install GitHub CLI.",
  detail: Option.none<string>(),
  auth: {
    status: "authenticated" as const,
    account: Option.some("octocat"),
    host: Option.some("github.com"),
    detail: Option.none<string>(),
  },
};

it("rejects oversized source-control discovery collections", () => {
  expect(() =>
    decodeDiscovery({
      versionControlSystems: Array.from(
        { length: SOURCE_CONTROL_DISCOVERY_VCS_MAX_COUNT + 1 },
        () => vcs,
      ),
      sourceControlProviders: [],
    }),
  ).toThrow();
  expect(() =>
    decodeDiscovery({
      versionControlSystems: [],
      sourceControlProviders: Array.from(
        { length: SOURCE_CONTROL_DISCOVERY_PROVIDER_MAX_COUNT + 1 },
        () => provider,
      ),
    }),
  ).toThrow();
});
