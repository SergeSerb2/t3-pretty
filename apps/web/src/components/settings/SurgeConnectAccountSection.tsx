import { useAuth, useClerk, useUser } from "@clerk/react";
import { SURGE_CODE_ACCOUNT_NAME, SURGE_CONNECT_NAME } from "@t3tools/shared/connectBranding";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

export interface SurgeConnectAccountPresentation {
  readonly action: "loading" | "manage" | "sign-in";
  readonly actionLabel: string;
  readonly description: string;
}

export function resolveSurgeConnectAccountPresentation(input: {
  readonly accountLabel: string | null;
  readonly isLoaded: boolean;
  readonly isSignedIn: boolean;
}): SurgeConnectAccountPresentation {
  if (!input.isLoaded) {
    return {
      action: "loading",
      actionLabel: "Checking…",
      description: `Checking your ${SURGE_CODE_ACCOUNT_NAME} sign-in status.`,
    };
  }
  if (!input.isSignedIn) {
    return {
      action: "sign-in",
      actionLabel: `Sign in to ${SURGE_CODE_ACCOUNT_NAME}`,
      description: `Sign in to discover and connect environments on your ${SURGE_CONNECT_NAME} mesh.`,
    };
  }
  return {
    action: "manage",
    actionLabel: "Manage account",
    description: input.accountLabel
      ? `Signed in as ${input.accountLabel}. Environments linked to this account appear below.`
      : `Signed in. Environments linked to this ${SURGE_CONNECT_NAME} account appear below.`,
  };
}

export function SurgeConnectAccountSection() {
  if (!hasCloudPublicConfig()) {
    return (
      <SettingsSection title={SURGE_CONNECT_NAME}>
        <SettingsRow
          {...searchableSetting("surge-connect-account")}
          title={`${SURGE_CODE_ACCOUNT_NAME} account`}
          description={`${SURGE_CONNECT_NAME} is unavailable because this build does not include its public connection configuration.`}
          control={
            <Button size="sm" variant="outline" disabled>
              Unavailable
            </Button>
          }
        />
      </SettingsSection>
    );
  }

  return <ConfiguredSurgeConnectAccountSection />;
}

function ConfiguredSurgeConnectAccountSection() {
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { user } = useUser();
  const clerk = useClerk();
  const { authPrompt, openAuthPrompt } = useT3ConnectAuthPrompt();
  const accountLabel = user?.primaryEmailAddress?.emailAddress ?? user?.username ?? null;
  const presentation = resolveSurgeConnectAccountPresentation({
    accountLabel,
    isLoaded,
    isSignedIn: Boolean(isSignedIn),
  });

  return (
    <SettingsSection title={SURGE_CONNECT_NAME}>
      <SettingsRow
        {...searchableSetting("surge-connect-account")}
        title={`${SURGE_CODE_ACCOUNT_NAME} account`}
        description={presentation.description}
        control={
          <Button
            size="sm"
            variant={presentation.action === "sign-in" ? "default" : "outline"}
            disabled={presentation.action === "loading"}
            onClick={
              presentation.action === "sign-in"
                ? openAuthPrompt
                : presentation.action === "manage"
                  ? () => clerk.openUserProfile()
                  : undefined
            }
          >
            {presentation.actionLabel}
          </Button>
        }
      />
      {authPrompt}
    </SettingsSection>
  );
}
