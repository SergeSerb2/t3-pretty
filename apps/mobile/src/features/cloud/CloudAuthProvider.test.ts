// @vitest-environment jsdom
import { managedRelaySessionAtom } from "@t3tools/client-runtime/relay";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "../../state/atom-registry";
import {
  activateCloudRelayAccount,
  CloudAuthProvider,
  deactivateCloudRelayAccount,
} from "./CloudAuthProvider";
import { setAgentAwarenessRelayTokenProvider } from "../agent-awareness/remoteRegistration";
import { resolveCloudPublicConfig } from "./publicConfig";

vi.mock("@clerk/expo", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    userId: "account-1",
    getToken: async () => "account-1-token",
  }),
}));

vi.mock("@clerk/expo/token-cache", () => ({
  tokenCache: {},
}));

vi.mock("../../lib/runtime", () => ({
  runtime: {
    runPromiseExit: vi.fn(),
  },
}));

vi.mock("../../connection/catalog", () => ({
  environmentCatalog: {
    removeRelayEnvironments: {},
  },
}));

vi.mock("./cloud-drafts", () => ({ removeCloudEnvironments: {} }));
vi.mock("../../state/use-composer-drafts", () => ({
  getComposerCloudAccountId: vi.fn(async () => null),
  restoreCloudComposerDrafts: vi.fn(async () => undefined),
}));

vi.mock("./publicConfig", () => ({
  resolveCloudPublicConfig: vi.fn(() => ({
    clerk: { publishableKey: null, jwtTemplate: null },
    relay: { url: null },
  })),
  resolveRelayClerkTokenOptions: vi.fn(),
}));

vi.mock("../agent-awareness/remoteRegistration", () => ({
  releaseAgentAwarenessRelayTokenProvider: vi.fn(),
  setAgentAwarenessRelayTokenProvider: vi.fn(),
  unregisterAgentAwarenessDeviceForCurrentUser: vi.fn(),
}));

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  deactivateCloudRelayAccount();
  vi.clearAllMocks();
});

describe("CloudAuthProvider relay account isolation", () => {
  it("keeps incomplete cloud auth inactive while manual pairing stays available", async () => {
    vi.mocked(resolveCloudPublicConfig).mockReturnValueOnce({
      clerk: { publishableKey: "pk_live_example", jwtTemplate: null },
      relay: { url: "https://relay.t3.codes" },
      observability: { tracesUrl: null, tracesDataset: null, tracesToken: null },
    });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    root = createRoot(container);
    await act(async () =>
      root!.render(
        createElement(
          CloudAuthProvider,
          null,
          createElement("button", null, "Pair a computer manually"),
        ),
      ),
    );

    expect(container.textContent).toBe("Pair a computer manually");
    expect(appAtomRegistry.get(managedRelaySessionAtom)).toBeNull();
  });

  it("clears relay and agent-awareness credentials before cleanup can fail", async () => {
    const tokenProvider = async () => "account-1-token";
    activateCloudRelayAccount("account-1", tokenProvider);
    expect(appAtomRegistry.get(managedRelaySessionAtom)?.accountId).toBe("account-1");

    deactivateCloudRelayAccount();
    const cleanup = Promise.reject(new Error("Persistence removal failed.")).catch(() => undefined);

    expect(appAtomRegistry.get(managedRelaySessionAtom)).toBeNull();
    expect(vi.mocked(setAgentAwarenessRelayTokenProvider)).toHaveBeenLastCalledWith(null);
    await cleanup;
  });
});
