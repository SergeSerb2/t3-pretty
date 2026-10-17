import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { SURGE_CONNECT_NAME } from "@t3tools/shared/connectBranding";

const state = vi.hoisted(() => ({ openClerkGate: vi.fn() }));

// The app deliberately has no ClerkProvider on unsupported public web origins.
// Keep Clerk's real hooks so an accidental read outside that boundary throws.
vi.mock("../../cloud/clerkGate", () => ({
  useCloudUiEnabled: () => false,
  useClerkGateOpen: () => false,
  openClerkGate: state.openClerkGate,
}));
vi.mock("../../cloud/publicConfig", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../cloud/publicConfig")>()),
  hasCloudPublicConfig: () => true,
}));
vi.mock("../ui/alert-dialog", () => {
  const Content = ({ children }: { children?: ReactNode }) => children;
  return {
    AlertDialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? children : null,
    AlertDialogClose: Content,
    AlertDialogDescription: Content,
    AlertDialogFooter: Content,
    AlertDialogHeader: Content,
    AlertDialogPopup: Content,
    AlertDialogTitle: Content,
  };
});
vi.mock("../ui/button", () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  InlineButton: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

import { RemoveT3ConnectEnvironmentDialog } from "./RemoveT3ConnectEnvironmentDialog";
import { T3ConnectSidebarAvatar } from "./T3ConnectSidebarSignIn";
import { ConnectOnboardingDialog } from "../cloud/ConnectOnboardingDialog";
import { SurgeConnectAccountSection } from "../settings/SurgeConnectAccountSection";

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  state.openClerkGate.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { location: new URL("http://localhost:7370/settings/connections") });
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", `pk_live_${btoa("clerk.t3.codes$")}`);
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("mounts the closed Connections removal dialog without a ClerkProvider", async () => {
  await act(async () => {
    renderer = create(
      <RemoveT3ConnectEnvironmentDialog
        environmentLabel={null}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
  });
  expect(renderer?.toJSON()).toBeNull();
});

it("can remove a saved environment and open account settings without a ClerkProvider", async () => {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  await act(async () => {
    renderer = create(
      <RemoveT3ConnectEnvironmentDialog
        environmentLabel="Studio Mac"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
  });
  const buttons = renderer!.root.findAllByType("button");
  await act(async () => {
    buttons.find((button) => button.props.children === "Remove from this device")!.props.onClick();
  });
  expect(onConfirm).toHaveBeenCalledOnce();
  await act(async () => {
    buttons.find((button) => button.props.children === "T3 Connect settings")!.props.onClick();
  });
  expect(onCancel).toHaveBeenCalledOnce();
  expect(state.openClerkGate).toHaveBeenCalledExactlyOnceWith({ promptSignIn: true });
});

it("keeps the Settings account entry, sidebar avatar and onboarding safe without a ClerkProvider", async () => {
  await act(async () => {
    renderer = create(
      <>
        <SurgeConnectAccountSection />
        <T3ConnectSidebarAvatar />
        <ConnectOnboardingDialog />
      </>,
    );
  });
  const openAccount = renderer!.root
    .findAllByType("button")
    .find((button) => button.props.children === `Open ${SURGE_CONNECT_NAME}`);
  expect(openAccount).toBeDefined();
  await act(async () => openAccount!.props.onClick());
  expect(state.openClerkGate).toHaveBeenCalledExactlyOnceWith({ promptSignIn: true });
});
