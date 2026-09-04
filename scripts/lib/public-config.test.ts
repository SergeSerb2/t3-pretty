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
