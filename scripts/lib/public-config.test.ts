// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadRepoEnv, readReleaseTrainVersion, resolvePublicConfig } from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  const official = {
    T3CODE_BUILD_FLAVOR: "public",
    T3CODE_PUBLIC_RELEASE: "1",
    T3CODE_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsudDMuY29kZXMk",
    T3CODE_CLERK_JWT_TEMPLATE: "t3-relay",
    T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "hzxSgY2cH10sDU2r",
    T3CODE_RELAY_URL: "https://relay.t3.codes",
  };

  it.each([".env", ".env.local"])(
    "rejects resolved internal settings from %s in a release",
    (file) => {
      const repoRoot = makeTemporaryDirectory();
      NodeFS.writeFileSync(
        NodePath.join(repoRoot, ".env.example"),
        Object.entries(official)
          .filter(([key]) => key !== "T3CODE_PUBLIC_RELEASE")
          .map(([key, value]) => `${key}=${value}`)
          .join("\n"),
      );
      const contaminants = [
        "T3CODE_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsuc2VyZ2VzZXJiaW5lbmtvLmNvbSQ",
        "VITE_T3CODE_RELAY_URL=https://relay.sergeserbinenko.com",
        "EXPO_PUBLIC_CLERK_JWT_TEMPLATE=internal-relay",
        "T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=d8yyrphoxfUzOISR",
        "T3CODE_CLERK_PASSKEY_RP_DOMAINS=clerk.sergeserbinenko.com",
        "T3CODE_MOBILE_EAS_PROJECT_ID=1eb51d67-48c5-4100-8aa8-f5ac9e1ada65",
        "T3CODE_MOBILE_UPDATE_URL=https://u.expo.dev/1eb51d67-48c5-4100-8aa8-f5ac9e1ada65",
        "T3CODE_DESKTOP_UPDATE_FEED_URL=https://internal.example.test/latest/",
        "T3CODE_DESKTOP_UPDATE_REPOSITORY=private-owner/internal-releases",
      ];
      for (const setting of contaminants) {
        NodeFS.writeFileSync(NodePath.join(repoRoot, file), `${setting}\n`);
        expect(() =>
          loadRepoEnv({
            baseEnv: { T3CODE_BUILD_FLAVOR: "public", T3CODE_PUBLIC_RELEASE: "1" },
            repoRoot,
          }),
        ).toThrow(/Public release/u);
      }
    },
  );

  it.each([
    "T3CODE_MOBILE_OTLP_TRACES_URL",
    "T3CODE_MOBILE_OTLP_TRACES_DATASET",
    "T3CODE_MOBILE_OTLP_TRACES_TOKEN",
    "EXPO_PUBLIC_OTLP_TRACES_URL",
    "EXPO_PUBLIC_OTLP_TRACES_DATASET",
    "EXPO_PUBLIC_OTLP_TRACES_TOKEN",
    "T3CODE_RELAY_CLIENT_OTLP_TRACES_URL",
    "T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET",
    "T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN",
    "VITE_RELAY_OTLP_TRACES_URL",
    "VITE_RELAY_OTLP_TRACES_DATASET",
    "VITE_RELAY_OTLP_TRACES_TOKEN",
  ])("rejects %s before it can enter a public bundle or Expo manifest", (key) => {
    expect(() =>
      loadRepoEnv({
        baseEnv: { ...official, [key]: "fixture-private-tracing-setting" },
        repoRoot: makeTemporaryDirectory(),
      }),
    ).toThrow(/Public release/u);
  });

  it("gates official snapshots even without an explicit release flag", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.mkdirSync(NodePath.join(repoRoot, ".t3-fork"));
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".t3-fork/public-release.json"), "{}");
    expect(() => loadRepoEnv({ baseEnv: { T3CODE_BUILD_FLAVOR: "public" }, repoRoot })).toThrow(
      /official T3 Connect/u,
    );
    expect(() =>
      loadRepoEnv({
        baseEnv: {
          ...official,
          T3CODE_BUILD_FLAVOR: "internal",
          T3CODE_PUBLIC_RELEASE: "0",
        },
        repoRoot,
      }),
    ).toThrow(/official T3 Connect/u);
    expect(loadRepoEnv({ baseEnv: official, repoRoot }).T3CODE_RELAY_URL).toBe(
      "https://relay.t3.codes",
    );
  });

  it("allows local native public builds without EAS and only explicitly selected public OTA projects", () => {
    const repoRoot = makeTemporaryDirectory();
    expect(
      loadRepoEnv({ baseEnv: official, repoRoot }).T3CODE_MOBILE_EAS_PROJECT_ID,
    ).toBeUndefined();
    const project = "11111111-2222-4333-8444-555555555555";
    expect(
      loadRepoEnv({
        baseEnv: {
          ...official,
          T3CODE_PUBLIC_MOBILE_EAS_PROJECT_ID: project,
          T3CODE_MOBILE_EAS_PROJECT_ID: project,
          T3CODE_MOBILE_UPDATE_URL: `https://u.expo.dev/${project}`,
        },
        repoRoot,
      }).T3CODE_MOBILE_UPDATE_URL,
    ).toBe(`https://u.expo.dev/${project}`);
    expect(() =>
      loadRepoEnv({
        baseEnv: {
          ...official,
          T3CODE_PUBLIC_MOBILE_EAS_PROJECT_ID: "1eb51d67-48c5-4100-8aa8-f5ac9e1ada65",
          T3CODE_MOBILE_EAS_PROJECT_ID: "1eb51d67-48c5-4100-8aa8-f5ac9e1ada65",
        },
        repoRoot,
      }),
    ).toThrow(/distinct/u);
  });

  it("does not project cloud configuration for an unconfigured clone", () => {
    const env = loadRepoEnv({ baseEnv: {}, repoRoot: makeTemporaryDirectory() });

    expect(env.T3CODE_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.T3CODE_CLERK_CLI_OAUTH_CLIENT_ID).toBeUndefined();
    expect(env.VITE_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(env.T3CODE_CLERK_JWT_TEMPLATE).toBeUndefined();
    expect(env.VITE_CLERK_JWT_TEMPLATE).toBeUndefined();
    expect(env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE).toBeUndefined();
    expect(env.T3CODE_RELAY_URL).toBeUndefined();
    expect(env.VITE_T3CODE_RELAY_URL).toBeUndefined();
    expect(env.T3CODE_MOBILE_OTLP_TRACES_URL).toBeUndefined();
    expect(env.T3CODE_MOBILE_OTLP_TRACES_DATASET).toBeUndefined();
    expect(env.T3CODE_MOBILE_OTLP_TRACES_TOKEN).toBeUndefined();
    expect(env.EXPO_PUBLIC_OTLP_TRACES_URL).toBeUndefined();
    expect(env.EXPO_PUBLIC_OTLP_TRACES_DATASET).toBeUndefined();
    expect(env.EXPO_PUBLIC_OTLP_TRACES_TOKEN).toBeUndefined();
    expect(env.T3CODE_RELAY_CLIENT_OTLP_TRACES_URL).toBeUndefined();
    expect(env.T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET).toBeUndefined();
    expect(env.T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN).toBeUndefined();
    expect(env.VITE_RELAY_OTLP_TRACES_URL).toBeUndefined();
    expect(env.VITE_RELAY_OTLP_TRACES_DATASET).toBeUndefined();
    expect(env.VITE_RELAY_OTLP_TRACES_TOKEN).toBeUndefined();
    expect(env.T3CODE_BUILD_FLAVOR).toBe("public");
    expect(env.VITE_T3CODE_BUILD_FLAVOR).toBe("public");
    expect(env.EXPO_PUBLIC_T3CODE_BUILD_FLAVOR).toBe("public");
  });

  it("projects the public T3 Connect defaults", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.example"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_fork\nT3CODE_CLERK_JWT_TEMPLATE=template_fork\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_fork\nT3CODE_RELAY_URL=https://relay.fork.example.test\n",
    );

    expect(loadRepoEnv({ baseEnv: {}, repoRoot })).toMatchObject({
      T3CODE_CLERK_PUBLISHABLE_KEY: "pk_fork",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_fork",
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_fork",
      T3CODE_CLERK_JWT_TEMPLATE: "template_fork",
      VITE_CLERK_JWT_TEMPLATE: "template_fork",
      EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "template_fork",
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_fork",
      VITE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_fork",
      T3CODE_RELAY_URL: "https://relay.fork.example.test",
      VITE_T3CODE_RELAY_URL: "https://relay.fork.example.test",
    });
  });

  it("selects internal defaults while preserving explicit overrides", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.internal.example"),
      "T3CODE_RELAY_URL=https://surge.example.test\nT3CODE_CLERK_PUBLISHABLE_KEY=pk_surge\n",
    );
    expect(loadRepoEnv({ baseEnv: { T3CODE_BUILD_FLAVOR: "internal" }, repoRoot })).toMatchObject({
      T3CODE_BUILD_FLAVOR: "internal",
      VITE_T3CODE_BUILD_FLAVOR: "internal",
      EXPO_PUBLIC_T3CODE_BUILD_FLAVOR: "internal",
      T3CODE_RELAY_URL: "https://surge.example.test",
    });
    expect(
      loadRepoEnv({
        baseEnv: {
          T3CODE_BUILD_FLAVOR: "internal",
          T3CODE_RELAY_URL: "https://override.example.test",
        },
        repoRoot,
      }).T3CODE_RELAY_URL,
    ).toBe("https://override.example.test");
  });

  it("applies process, root local, and root precedence in that order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.example"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_parent\nT3CODE_CLERK_JWT_TEMPLATE=template_parent\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_parent\nT3CODE_RELAY_URL=https://parent.example.test\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_root\nT3CODE_CLERK_JWT_TEMPLATE=template_root\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_root\nT3CODE_RELAY_URL=https://root.example.test\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env.local"),
      "T3CODE_CLERK_PUBLISHABLE_KEY=pk_local\nT3CODE_CLERK_JWT_TEMPLATE=template_local\nT3CODE_CLERK_CLI_OAUTH_CLIENT_ID=oauth_local\nT3CODE_RELAY_URL=https://local.example.test\n",
    );

    expect(loadRepoEnv({ baseEnv: {}, repoRoot }).T3CODE_RELAY_URL).toBe(
      "https://local.example.test",
    );
    expect(
      loadRepoEnv({
        baseEnv: {
          T3CODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
          T3CODE_CLERK_JWT_TEMPLATE: "template_ci",
          T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
          T3CODE_RELAY_URL: "https://ci.example.test",
        },
        repoRoot,
      }),
    ).toMatchObject({
      T3CODE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_ci",
      VITE_CLERK_PUBLISHABLE_KEY: "pk_ci",
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_ci",
      T3CODE_CLERK_JWT_TEMPLATE: "template_ci",
      VITE_CLERK_JWT_TEMPLATE: "template_ci",
      EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "template_ci",
      T3CODE_RELAY_URL: "https://ci.example.test",
      VITE_T3CODE_RELAY_URL: "https://ci.example.test",
    });
  });

  it("rejects oversized repository environment files before parsing", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".env.local"), "a".repeat(1024 * 1024 + 1));

    expect(() => loadRepoEnv({ baseEnv: {}, repoRoot })).toThrow(/safety limit/u);
  });

  it("accepts legacy framework aliases as root overrides", () => {
    expect(
      resolvePublicConfig({
        VITE_CLERK_PUBLISHABLE_KEY: "pk_legacy",
        VITE_CLERK_JWT_TEMPLATE: "template_legacy",
        T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "oauth_canonical",
        VITE_T3CODE_RELAY_URL: "https://legacy.example.test",
        EXPO_PUBLIC_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
        EXPO_PUBLIC_OTLP_TRACES_DATASET: "mobile-traces",
        EXPO_PUBLIC_OTLP_TRACES_TOKEN: "mobile-token",
      }),
    ).toEqual({
      buildFlavor: "public",
      clerkPublishableKey: "pk_legacy",
      clerkJwtTemplate: "template_legacy",
      clerkCliOAuthClientId: "oauth_canonical",
      relayUrl: "https://legacy.example.test",
      mobileOtlpTracesUrl: "https://api.axiom.co/v1/traces",
      mobileOtlpTracesDataset: "mobile-traces",
      mobileOtlpTracesToken: "mobile-token",
      relayClientOtlpTracesUrl: undefined,
      relayClientOtlpTracesDataset: undefined,
      relayClientOtlpTracesToken: undefined,
    });
  });

  it("projects canonical relay client tracing values to web build aliases", () => {
    expect(
      loadRepoEnv({
        baseEnv: {
          T3CODE_RELAY_CLIENT_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
          T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET: "relay-client-traces",
          T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: "relay-client-token",
        },
        repoRoot: makeTemporaryDirectory(),
      }),
    ).toEqual({
      T3CODE_RELAY_CLIENT_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET: "relay-client-traces",
      T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: "relay-client-token",
      VITE_RELAY_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      VITE_RELAY_OTLP_TRACES_DATASET: "relay-client-traces",
      VITE_RELAY_OTLP_TRACES_TOKEN: "relay-client-token",
      T3CODE_BUILD_FLAVOR: "public",
      VITE_T3CODE_BUILD_FLAVOR: "public",
      EXPO_PUBLIC_T3CODE_BUILD_FLAVOR: "public",
    });
  });

  it("projects canonical mobile tracing values to Expo public aliases", () => {
    expect(
      loadRepoEnv({
        baseEnv: {
          T3CODE_RELAY_URL: "https://relay.example.test",
          T3CODE_MOBILE_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
          T3CODE_MOBILE_OTLP_TRACES_DATASET: "mobile-traces",
          T3CODE_MOBILE_OTLP_TRACES_TOKEN: "mobile-token",
        },
        repoRoot: makeTemporaryDirectory(),
      }),
    ).toEqual({
      T3CODE_BUILD_FLAVOR: "public",
      VITE_T3CODE_BUILD_FLAVOR: "public",
      EXPO_PUBLIC_T3CODE_BUILD_FLAVOR: "public",
      T3CODE_RELAY_URL: "https://relay.example.test",
      VITE_T3CODE_RELAY_URL: "https://relay.example.test",
      T3CODE_MOBILE_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      T3CODE_MOBILE_OTLP_TRACES_DATASET: "mobile-traces",
      T3CODE_MOBILE_OTLP_TRACES_TOKEN: "mobile-token",
      EXPO_PUBLIC_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
      EXPO_PUBLIC_OTLP_TRACES_DATASET: "mobile-traces",
      EXPO_PUBLIC_OTLP_TRACES_TOKEN: "mobile-token",
    });
  });
});

describe("readReleaseTrainVersion", () => {
  it.each(["snapshot", "explicit"])(
    "uses the public release version instead of the retained nightly marker for %s builds",
    (mode) => {
      const repoRoot = makeTemporaryDirectory();
      NodeFS.mkdirSync(NodePath.join(repoRoot, ".t3-fork"));
      NodeFS.mkdirSync(NodePath.join(repoRoot, "apps/web"), { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(repoRoot, ".t3-fork/upstream-nightly"),
        "v0.0.46-nightly.20261015.3176\n",
      );
      NodeFS.writeFileSync(
        NodePath.join(repoRoot, "apps/web/package.json"),
        JSON.stringify({ version: mode === "snapshot" ? "0.0.45" : "1.2.3" }),
      );
      if (mode === "snapshot") {
        NodeFS.writeFileSync(
          NodePath.join(repoRoot, ".t3-fork/public-release.json"),
          JSON.stringify({ version: "1.2.3", originCommit: "a".repeat(40) }),
        );
      }
      expect(
        readReleaseTrainVersion(repoRoot, {
          T3CODE_PUBLIC_RELEASE: mode === "explicit" ? "1" : "0",
        }),
      ).toBe("1.2.3");
    },
  );

  it("prefers the integrated upstream nightly version in fork checkouts", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.mkdirSync(NodePath.join(repoRoot, ".t3-fork"));
    NodeFS.mkdirSync(NodePath.join(repoRoot, "apps/web"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".t3-fork/upstream-nightly"),
      "v0.0.34-nightly.20260811.1067\n",
    );
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, "apps/web/package.json"),
      '{"version":"0.0.33"}\n',
    );

    expect(readReleaseTrainVersion(repoRoot)).toBe("0.0.34-nightly.20260811.1067");
  });

  it("falls back to the web package version outside a synced fork", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.mkdirSync(NodePath.join(repoRoot, "apps/web"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, "apps/web/package.json"),
      '{"version":"0.0.33"}\n',
    );

    expect(readReleaseTrainVersion(repoRoot)).toBe("0.0.33");
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3code-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
