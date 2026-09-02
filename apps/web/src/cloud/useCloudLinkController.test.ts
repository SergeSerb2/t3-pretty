import * as Option from "effect/Option";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { reactHookHarness as hooks } from "../test/reactHookHarness";

const atoms = vi.hoisted(() => ({
  link: Symbol("link"),
  preferences: Symbol("preferences"),
  refresh: Symbol("refresh"),
  unlink: Symbol("unlink"),
}));
const commands = vi.hoisted(() => ({
  link: vi.fn(),
  preferences: vi.fn(),
  refresh: vi.fn(),
  unlink: vi.fn(),
}));
const primaryLinkState = vi.hoisted(() => ({
  data: {
    linked: true,
    cloudUserId: "user-1",
    relayUrl: "https://relay.example.test",
    relayIssuer: "https://relay.example.test",
    managedTunnelActive: true,
    publishAgentActivity: false,
  },
  error: null,
  isPending: false,
  refresh: vi.fn(),
  target: {
    environmentId: "local-environment",
    label: "Local Mac",
    httpBaseUrl: "http://127.0.0.1:3773",
    wsBaseUrl: "ws://127.0.0.1:3773",
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../test/reactHookHarness");
  return { ...actual, useState: reactHookHarness.useState };
});
vi.mock("@clerk/react", () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue("clerk-token"),
    isSignedIn: true,
    userId: "user-1",
  }),
}));
vi.mock("../components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("../hooks/useCopyTraceId", () => ({ useCopyTraceId: () => vi.fn() }));
vi.mock("../state/environments", () => ({
  useRelayEnvironmentDiscovery: () => ({
    environments: new Map(),
    loaded: true,
    refreshing: false,
    offline: false,
    error: Option.none(),
  }),
}));
vi.mock("../state/relay", () => ({
  relayEnvironmentDiscovery: { refresh: atoms.refresh },
}));
vi.mock("../state/use-atom-command", () => ({
  useAtomCommand: (atom: symbol) => {
    if (atom === atoms.link) return commands.link;
    if (atom === atoms.unlink) return commands.unlink;
    if (atom === atoms.preferences) return commands.preferences;
    return commands.refresh;
  },
}));
vi.mock("./linkEnvironment", () => ({
  isCloudLinkOnConfiguredRelayForAccount: () => true,
}));
vi.mock("./linkEnvironmentAtoms", () => ({
  linkPrimaryEnvironment: atoms.link,
  unlinkPrimaryEnvironment: atoms.unlink,
  updatePrimaryEnvironmentPreferences: atoms.preferences,
}));
vi.mock("./primaryCloudLinkState", () => ({
  usePrimaryCloudLinkState: () => primaryLinkState,
}));
vi.mock("./publicConfig", () => ({
  resolveCloudPublicConfig: () => ({ relayUrl: "https://relay.example.test" }),
  resolveRelayClerkTokenOptions: () => ({ template: "t3-relay" }),
}));

import { useCloudLinkController } from "./useCloudLinkController";

describe("useCloudLinkController", () => {
  beforeEach(() => {
    hooks.reset();
    primaryLinkState.refresh.mockReset();
    commands.link.mockReset().mockResolvedValue({ _tag: "Success" });
    commands.unlink.mockReset().mockResolvedValue({ _tag: "Success" });
    commands.preferences.mockReset().mockResolvedValue({ _tag: "Success" });
    commands.refresh.mockReset().mockResolvedValue({ _tag: "Success" });
  });

  it("re-links an explicitly enabled desktop missing from relay membership", async () => {
    hooks.beginRender();
    const controller = useCloudLinkController();

    expect(controller.relayMembershipMissing).toBe(true);
    expect(controller.managedTunnelActive).toBe(false);

    await controller.reconcileCloudState({ managedTunnel: true, publish: false });

    expect(commands.link).toHaveBeenCalledWith({
      target: primaryLinkState.target,
      clerkToken: "clerk-token",
      mode: "managed",
    });
    expect(commands.preferences).toHaveBeenCalledWith({
      target: primaryLinkState.target,
      publishAgentActivity: false,
    });
    expect(commands.refresh).toHaveBeenCalledTimes(1);
  });
});
