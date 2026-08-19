import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { findAppOAuthClientFamily, type EnvironmentId } from "@t3tools/contracts";
import { useCallback, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { CopyTextButton } from "../../components/CopyTextButton";
import { useThemeColor } from "../../lib/useThemeColor";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentServerConfig } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { ConnectionSheetButton } from "../connection/ConnectionSheetButton";
import { SettingsSection } from "./components/SettingsSection";
import { appsCallbackOrigin, appsOAuthRedirectUri } from "./apps/appsSettings.logic";

type SettingsAppOAuthClientParams = {
  readonly environmentId: string;
  readonly family: string;
};

/**
 * Bring-your-own OAuth client for the authorization servers that have no
 * dynamic client registration. One client per family unlocks every catalog app
 * in it.
 */
export function SettingsAppOAuthClientRouteScreen({
  route,
}: StaticScreenProps<SettingsAppOAuthClientParams>) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const iconColor = useThemeColor("--color-icon");
  const environmentId = route.params.environmentId as EnvironmentId;
  const family = findAppOAuthClientFamily(route.params.family);
  const serverConfig = useEnvironmentServerConfig(environmentId);
  const stored = serverConfig?.settings.apps.oauthClients[route.params.family];
  const { savedConnectionsById } = useSavedRemoteConnections();
  const redirectUri = (() => {
    const origin = appsCallbackOrigin(savedConnectionsById[environmentId]?.httpBaseUrl);
    return origin === null ? null : appsOAuthRedirectUri(origin);
  })();

  const [clientId, setClientId] = useState(stored?.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const setOAuthClient = useAtomCommand(serverEnvironment.appsSetOAuthClient, {
    reportFailure: false,
  });

  const reportFailure = useCallback(
    (title: string, result: AtomCommandResult<unknown, unknown>) => {
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      Alert.alert(title, error instanceof Error ? error.message : "An error occurred.");
      return;
    },
    [],
  );

  const submit = useCallback(
    async (input: { readonly clientId: string; readonly clientSecret?: string }) => {
      setIsSaving(true);
      try {
        const result = await setOAuthClient({
          environmentId,
          input: { family: route.params.family, ...input },
        });
        if (result._tag !== "Success") {
          reportFailure("Couldn't save OAuth client", result);
          return;
        }
        navigation.goBack();
      } finally {
        setIsSaving(false);
      }
    },
    [environmentId, navigation, reportFailure, route.params.family, setOAuthClient],
  );

  if (family === undefined) {
    return (
      <View collapsable={false} className="flex-1 bg-sheet">
        <NativeStackScreenOptions options={{ title: "OAuth client" }} />
        <View className="px-5 pt-6">
          <Text className="text-base text-foreground-muted">
            This app store does not know that OAuth client family.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NativeStackScreenOptions options={{ title: family.name }} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentInset={{ bottom: Math.max(insets.bottom, 18) }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4 pb-[18px]"
      >
        <SettingsSection title="Redirect URI">
          <View className="flex-row items-center gap-3 p-4">
            <Text className="min-w-0 flex-1 text-sm text-foreground" selectable>
              {redirectUri ?? "Unavailable — this device has no address for the environment."}
            </Text>
            {redirectUri === null ? null : (
              <CopyTextButton
                accessibilityLabel="Copy redirect URI"
                text={redirectUri}
                tintColor={iconColor}
              />
            )}
          </View>
        </SettingsSection>

        <SettingsSection title="Steps">
          <View className="gap-2 p-4">
            {family.steps.map((step, index) => (
              <View key={step} className="flex-row gap-2">
                <Text className="text-sm tabular-nums text-foreground-muted">{index + 1}.</Text>
                <Text className="min-w-0 flex-1 text-sm leading-normal text-foreground-muted">
                  {step}
                </Text>
              </View>
            ))}
            <Pressable
              accessibilityRole="link"
              className="pt-1"
              onPress={() => void Linking.openURL(family.consoleUrl)}
            >
              <Text className="text-sm text-primary">Open {family.name} console</Text>
            </Pressable>
          </View>
        </SettingsSection>

        <SettingsSection title="Credentials">
          <View className="gap-4 p-4">
            <View className="gap-1.5">
              <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
                Client ID
              </Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setClientId}
                placeholder="1234567890-abc.apps.googleusercontent.com"
                value={clientId}
              />
            </View>
            <View className="gap-1.5">
              <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
                Client secret
              </Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setClientSecret}
                placeholder={
                  stored?.hasClientSecret === true ? "Stored — enter to replace" : "Client secret"
                }
                secureTextEntry
                value={clientSecret}
              />
            </View>
            <ConnectionSheetButton
              disabled={clientId.trim().length === 0 || isSaving}
              icon="checkmark"
              label={isSaving ? "Saving…" : "Save"}
              tone="primary"
              onPress={() =>
                void submit({
                  clientId: clientId.trim(),
                  // Omitting the secret keeps the stored one; sending it empty
                  // would clear a secret the user never meant to touch.
                  ...(clientSecret.trim().length > 0 ? { clientSecret: clientSecret.trim() } : {}),
                })
              }
            />
            {stored === undefined ? null : (
              <ConnectionSheetButton
                disabled={isSaving}
                icon="trash"
                label="Remove client"
                tone="danger"
                onPress={() =>
                  Alert.alert(
                    `Remove ${family.name}?`,
                    "Apps in this family will not be able to sign in until you add a client again.",
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Remove",
                        style: "destructive",
                        onPress: () => void submit({ clientId: "", clientSecret: "" }),
                      },
                    ],
                  )
                }
              />
            )}
          </View>
        </SettingsSection>
      </ScrollView>
    </View>
  );
}
