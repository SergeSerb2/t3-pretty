import { UserButton, useAuth } from "@clerk/react";
import { SURGE_CODE_ACCOUNT_NAME, SURGE_CONNECT_NAME } from "@t3tools/shared/connectBranding";
import { LogInIcon, ServerIcon, SmartphoneIcon } from "lucide-react";

import { openClerkGate, useClerkGateOpen } from "../../cloud/clerkGate";
import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { MobileClientsUserProfilePage } from "./MobileClientsUserProfilePage";
import { T3ConnectUserProfilePage } from "./T3ConnectUserProfilePage";
import { useT3ConnectAuthPrompt } from "./useT3ConnectAuthPrompt";

export function T3ConnectSidebarSignIn() {
  const clerkGateOpen = useClerkGateOpen();

  if (!hasCloudPublicConfig()) return null;
  // Clerk has not been loaded on this install yet: offer the same entry point,
  // which loads it and opens the dialog (see cloud/clerkGate).
  if (!clerkGateOpen) return <SignInButton onClick={() => openClerkGate({ promptSignIn: true })} />;

  return <ConfiguredT3ConnectSidebarSignIn />;
}

export function T3ConnectSidebarAvatar() {
  const clerkGateOpen = useClerkGateOpen();

  if (!hasCloudPublicConfig() || !clerkGateOpen) return null;

  return <ConfiguredT3ConnectSidebarAvatar />;
}

function SignInButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton onClick={onClick}>
          <LogInIcon />
          <span>Sign in to {SURGE_CODE_ACCOUNT_NAME}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function ConfiguredT3ConnectSidebarAvatar() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded || !isSignedIn) return null;

  return (
    <UserButton
      appearance={{
        elements: {
          avatarBox: "size-7",
          userButtonTrigger: "rounded-lg p-1 hover:bg-sidebar-row-hover",
        },
      }}
    >
      <UserButton.UserProfilePage
        label="Mobile clients"
        labelIcon={<SmartphoneIcon className="size-4" />}
        url="mobile-clients"
      >
        <MobileClientsUserProfilePage />
      </UserButton.UserProfilePage>
      <UserButton.UserProfilePage
        label={SURGE_CONNECT_NAME}
        labelIcon={<ServerIcon className="size-4" />}
        url="t3-connect"
      >
        <T3ConnectUserProfilePage />
      </UserButton.UserProfilePage>
    </UserButton>
  );
}

function ConfiguredT3ConnectSidebarSignIn() {
  const { isLoaded, isSignedIn } = useAuth();
  const { authPrompt, openAuthPrompt } = useT3ConnectAuthPrompt();

  if (!isLoaded || isSignedIn) return null;

  return (
    <>
      <SignInButton onClick={openAuthPrompt} />
      {authPrompt}
    </>
  );
}
