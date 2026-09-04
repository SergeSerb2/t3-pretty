import { EnvironmentId } from "@t3tools/contracts";
import type { RelayClientEnvironmentRecord } from "@t3tools/contracts/relay";
import * as Option from "effect/Option";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { visitElements } from "../../test/reactElementTree";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";

const atoms = vi.hoisted(() => ({
  refresh: Symbol("refresh"),
  register: Symbol("register"),
}));
const commands = vi.hoisted(() => ({
  refresh: vi.fn(),
  register: vi.fn(),
}));
const cloudLink = vi.hoisted(() => ({
  managedTunnelActive: false,
  storedPublishAgentActivity: false,
  reconcileCloudState: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return {
    ...actual,
    useCallback: reactHookHarness.useCallback,
    useEffect: (effect: () => void | (() => void)) => {
      effect();
    },
    useMemo: reactHookHarness.useMemo,
    useRef: reactHookHarness.useRef,
    useState: reactHookHarness.useState,
  };
});

vi.mock("react/compiler-runtime", async () => {
  const { reactHookHarness } = await import("../../test/reactHookHarness");
  return { c: reactHookHarness.useMemoCache };
});

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ userId: "user-1" }),
}));
vi.mock("~/connection/catalog", () => ({
  environmentCatalog: { refresh: atoms.refresh, register: atoms.register },
}));
vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/state/relay", () => ({
  relayEnvironmentDiscovery: { refresh: atoms.refresh },
}));
vi.mock("~/state/environments", () => ({
  useRelayEnvironmentDiscovery: () => ({
    environments: new Map([
      [
        "remote-environment",
        {
          environment: REMOTE_ENVIRONMENT,
          availability: "online",
          status: Option.none(),
          error: Option.none(),
        },
      ],
    ]),
    loaded: true,
    refreshing: false,
    offline: false,
    error: Option.none(),
  }),
}));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (atom: symbol) =>
    atom === atoms.register ? commands.register : commands.refresh,
}));
vi.mock("~/cloud/useCloudLinkController", () => ({
  useCloudLinkController: () => cloudLink,
}));
vi.mock("~/hooks/useCopyTraceId", () => ({ useCopyTraceId: () => vi.fn() }));
vi.mock("../ui/toast", () => ({ toastManager: { add: vi.fn() } }));

import { CloudEnvironmentConnectRows } from "./CloudEnvironmentConnectList";

const REMOTE_ENVIRONMENT: RelayClientEnvironmentRecord = {
  environmentId: EnvironmentId.make("remote-environment"),
  label: "Remote Mac",
  endpoint: {
    httpBaseUrl: "https://remote.example.test",
    wsBaseUrl: "wss://remote.example.test",
    providerKind: "cloudflare_tunnel",
  },
  linkedAt: "2026-08-27T00:00:00.000Z",
};

function renderConnectButton() {
  hooks.beginRender();
  const rows = CloudEnvironmentConnectRows({
    primaryEnvironmentId: EnvironmentId.make("local-environment"),
    savedEnvironments: [],
  });
  return visitElements(rows, (element) => element.props.children === "Connect");
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("CloudEnvironmentConnectRows", () => {
  beforeEach(() => {
    hooks.reset();
    commands.refresh.mockReset().mockResolvedValue({ _tag: "Success" });
    commands.register.mockReset().mockResolvedValue({ _tag: "Success" });
    cloudLink.managedTunnelActive = false;
    cloudLink.storedPublishAgentActivity = false;
    cloudLink.reconcileCloudState.mockReset();
  });

  it("publishes the local desktop before saving the remote connection", async () => {
    let finishLink: ((linked: boolean) => void) | undefined;
    cloudLink.reconcileCloudState.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishLink = resolve;
      }),
    );
    const button = renderConnectButton();

    expect(button).not.toBeNull();
    (button?.props.onClick as (() => void) | undefined)?.();
    await flushPromises();

    expect(cloudLink.reconcileCloudState).toHaveBeenCalledWith({
      managedTunnel: true,
      publish: false,
    });
    expect(commands.register).not.toHaveBeenCalled();

    finishLink?.(true);
    await flushPromises();

    expect(commands.register).toHaveBeenCalledTimes(1);
  });

  it("does not leave a one-way remote connection when local publishing fails", async () => {
    cloudLink.reconcileCloudState.mockResolvedValue(false);
    const button = renderConnectButton();

    (button?.props.onClick as (() => void) | undefined)?.();
    await flushPromises();

    expect(commands.register).not.toHaveBeenCalled();
  });
});
