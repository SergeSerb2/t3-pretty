import type { MenuAction } from "@react-native-menu/menu";
import { useNavigation } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  APP_OAUTH_CLIENT_FAMILIES,
  AppConnectionId,
  findAppOAuthClientFamily,
  type AppAuthKind,
  type AppCatalogEntry,
  type AppConnection,
  type AppsSettings,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AnchoredMenu } from "../../components/AndroidAnchoredMenu";
import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import { uuidv4 } from "../../lib/uuid";
import { useEnvironmentServerConfig } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  useRemoteConnectionStatus,
  useSavedRemoteConnections,
} from "../../state/use-remote-environment-registry";
import { SettingsSection } from "./components/SettingsSection";
import {
  appAuthChoices,
  appAvatarColor,
  appCatalogGroups,
  appConnectionInput,
  appConnectionStatus,
  appMonogram,
  appsCallbackOrigin,
  catalogConnectionInput,
  requiredOAuthClientFamily,
  sortedAppConnections,
  type AppStatus,
} from "./apps/appsSettings.logic";

const EMPTY_APPS: AppsSettings = { connections: {}, oauthClients: {} };

/** What an app row's menu can act on, whether stored or just created. */
interface AppTarget {
  readonly id: AppConnectionId;
  readonly name: string;
  readonly auth: AppAuthKind;
  readonly catalogId: string | null;
}

export function SettingsAppsRouteScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const { connectedEnvironments } = useRemoteConnectionStatus();
  const [query, setQuery] = useState("");

  const environments = useMemo(
    () =>
      Object.values(savedConnectionsById).sort((left, right) =>
        left.environmentLabel.localeCompare(right.environmentLabel),
      ),
    [savedConnectionsById],
  );
  const preferredEnvironmentId =
    connectedEnvironments.find((environment) => environment.connectionState === "connected")
      ?.environmentId ??
    environments[0]?.environmentId ??
    null;
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(
    preferredEnvironmentId,
  );
  useEffect(() => {
    if (selectedEnvironmentId !== null && savedConnectionsById[selectedEnvironmentId]) return;
    setSelectedEnvironmentId(preferredEnvironmentId);
  }, [preferredEnvironmentId, savedConnectionsById, selectedEnvironmentId]);

  const environmentId = selectedEnvironmentId;
  const serverConfig = useEnvironmentServerConfig(environmentId);
  const apps = serverConfig?.settings.apps ?? EMPTY_APPS;
  const callbackOrigin =
    environmentId === null
      ? null
      : appsCallbackOrigin(savedConnectionsById[environmentId]?.httpBaseUrl);
  const connections = useMemo(() => sortedAppConnections(apps), [apps]);
  const takenSlugs = useMemo(() => connections.map((connection) => connection.slug), [connections]);
  const addedCatalogIds = useMemo(
    () =>
      new Set(
        connections
          .map((connection) => connection.catalogId)
          .filter((catalogId): catalogId is string => catalogId !== null),
      ),
    [connections],
  );
  const groups = useMemo(() => appCatalogGroups(query), [query]);

  const upsert = useAtomCommand(serverEnvironment.appsUpsert, { reportFailure: false });
  const remove = useAtomCommand(serverEnvironment.appsRemove, { reportFailure: false });
  const authorize = useAtomCommand(serverEnvironment.appsAuthorize, { reportFailure: false });
  const disconnect = useAtomCommand(serverEnvironment.appsDisconnect, { reportFailure: false });
  const test = useAtomCommand(serverEnvironment.appsTest, { reportFailure: false });

  const reportFailure = useCallback(
    (title: string, result: AtomCommandResult<unknown, unknown>) => {
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      Alert.alert(title, error instanceof Error ? error.message : "An error occurred.");
    },
    [],
  );

  const openAppEditor = useCallback(
    (connectionId?: AppConnectionId) => {
      if (environmentId === null) return;
      navigation.navigate("SettingsSheet", {
        screen: "SettingsContent",
        params: {
          screen: "SettingsAppEdit",
          params: { environmentId, ...(connectionId ? { connectionId } : {}) },
        },
      });
    },
    [environmentId, navigation],
  );

  const openOAuthClient = useCallback(
    (family: string) => {
      if (environmentId === null) return;
      navigation.navigate("SettingsSheet", {
        screen: "SettingsContent",
        params: { screen: "SettingsAppOAuthClient", params: { environmentId, family } },
      });
    },
    [environmentId, navigation],
  );

  const connect = useCallback(
    async (target: AppTarget) => {
      if (environmentId === null) return;
      const family = requiredOAuthClientFamily(target, apps.oauthClients);
      if (family !== null) {
        const familyName = findAppOAuthClientFamily(family)?.name ?? family;
        Alert.alert(
          `${target.name} needs an OAuth client`,
          `${familyName} does not hand out clients automatically. Add a Client ID and secret once, then every app in that family can sign in.`,
          [
            { text: "Later", style: "cancel" },
            { text: "Set up", onPress: () => openOAuthClient(family) },
          ],
        );
        return;
      }
      if (callbackOrigin === null) {
        Alert.alert(
          "No reachable address",
          "This device does not know which URL it reaches this environment through, so it cannot build an OAuth redirect.",
        );
        return;
      }
      const result = await authorize({
        environmentId,
        input: { connectionId: target.id, callbackOrigin },
      });
      if (result._tag !== "Success") {
        reportFailure(`Couldn't sign in to ${target.name}`, result);
        return;
      }
      // The redirect lands on the environment server, which renders a
      // "you can close this window" page; the settings stream flips
      // `authorizedAt` on its own, so there is nothing to wait for here.
      await WebBrowser.openBrowserAsync(result.value.authorizationUrl);
    },
    [apps.oauthClients, authorize, callbackOrigin, environmentId, openOAuthClient, reportFailure],
  );

  const runTest = useCallback(
    async (target: AppTarget) => {
      if (environmentId === null) return;
      const result = await test({ environmentId, input: { connectionId: target.id } });
      if (result._tag !== "Success") {
        reportFailure(`${target.name} test failed`, result);
        return;
      }
      const { serverName, tools } = result.value;
      const preview = tools
        .slice(0, 5)
        .map((tool) => `• ${tool.name}`)
        .join("\n");
      Alert.alert(
        serverName ?? target.name,
        tools.length === 0
          ? "Connected, but this server exposes no tools."
          : `${tools.length} tool${tools.length === 1 ? "" : "s"} available.\n\n${preview}${
              tools.length > 5 ? "\n…" : ""
            }`,
      );
    },
    [environmentId, reportFailure, test],
  );

  const confirm = useCallback(
    (title: string, message: string, confirmLabel: string, run: () => void) => {
      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel" },
        { text: confirmLabel, style: "destructive", onPress: run },
      ]);
    },
    [],
  );

  const setEnabled = useCallback(
    async (connection: AppConnection, enabled: boolean) => {
      if (environmentId === null) return;
      const result = await upsert({
        environmentId,
        input: { connection: { ...appConnectionInput(connection), enabled } },
      });
      reportFailure(`Couldn't update ${connection.name}`, result);
    },
    [environmentId, reportFailure, upsert],
  );

  const addCatalogEntry = useCallback(
    async (entry: AppCatalogEntry, auth: AppAuthKind) => {
      if (environmentId === null) return;
      const id = AppConnectionId.make(uuidv4());
      const connection = catalogConnectionInput({ id, entry, auth, takenSlugs });
      const result = await upsert({ environmentId, input: { connection } });
      if (result._tag !== "Success") {
        reportFailure(`Couldn't add ${entry.name}`, result);
        return;
      }
      const target: AppTarget = { id, name: entry.name, auth, catalogId: entry.id };
      if (auth === "token") {
        openAppEditor(id);
        return;
      }
      if (auth === "oauth") {
        await connect(target);
      }
    },
    [connect, environmentId, openAppEditor, reportFailure, takenSlugs, upsert],
  );

  const handleCatalogPress = useCallback(
    (entry: AppCatalogEntry) => {
      const choices = appAuthChoices(entry);
      if (choices.oauth && choices.token) {
        Alert.alert(entry.name, "Sign in with your account, or paste an API token instead.", [
          { text: "Cancel", style: "cancel" },
          { text: "Use a token", onPress: () => void addCatalogEntry(entry, "token") },
          { text: "Sign in", onPress: () => void addCatalogEntry(entry, "oauth") },
        ]);
        return;
      }
      void addCatalogEntry(entry, choices.oauth ? "oauth" : choices.token ? "token" : "none");
    },
    [addCatalogEntry],
  );

  const buildActions = useCallback(
    (
      connection: AppConnection,
    ): ReadonlyArray<{ readonly action: MenuAction; readonly run: () => void }> => {
      if (environmentId === null) return [];
      const target: AppTarget = {
        id: connection.id,
        name: connection.name,
        auth: connection.auth,
        catalogId: connection.catalogId,
      };
      const items: Array<{ readonly action: MenuAction; readonly run: () => void }> = [];
      if (connection.auth === "oauth") {
        items.push({
          action: {
            id: "connect",
            title: connection.authorizedAt === null ? "Connect" : "Reconnect",
            image: "arrow.up.right",
          },
          run: () => void connect(target),
        });
      }
      if (connection.auth === "token") {
        items.push({
          action: { id: "token", title: "Set token…", image: "key" },
          run: () => openAppEditor(connection.id),
        });
      }
      items.push({
        action: { id: "test", title: "Test", image: "checkmark.circle" },
        run: () => void runTest(target),
      });
      items.push({
        action: { id: "edit", title: "Edit", image: "square.and.pencil" },
        run: () => openAppEditor(connection.id),
      });
      if (connection.authorizedAt !== null) {
        items.push({
          action: { id: "disconnect", title: "Disconnect", image: "minus.circle" },
          run: () =>
            confirm(
              `Disconnect ${connection.name}?`,
              "The stored credential is deleted. The app stays in this list so you can sign in again.",
              "Disconnect",
              () => {
                void (async () => {
                  const result = await disconnect({
                    environmentId,
                    input: { connectionId: connection.id },
                  });
                  reportFailure(`Couldn't disconnect ${connection.name}`, result);
                })();
              },
            ),
        });
      }
      items.push({
        action: {
          id: "remove",
          title: "Remove",
          image: "trash",
          attributes: { destructive: true },
        },
        run: () =>
          confirm(
            `Remove ${connection.name}?`,
            "The app and its credential are deleted from this environment.",
            "Remove",
            () => {
              void (async () => {
                const result = await remove({
                  environmentId,
                  input: { connectionId: connection.id },
                });
                reportFailure(`Couldn't remove ${connection.name}`, result);
              })();
            },
          ),
      });
      return items;
    },
    [confirm, connect, disconnect, environmentId, openAppEditor, remove, reportFailure, runTest],
  );

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentInset={{ bottom: Math.max(insets.bottom, 18) }}
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4 pb-[18px]"
        keyboardShouldPersistTaps="handled"
      >
        {environments.length > 1 ? (
          <View className="flex-row flex-wrap gap-2">
            {environments.map((environment) => (
              <Pressable
                key={environment.environmentId}
                accessibilityRole="button"
                accessibilityState={{
                  selected: environment.environmentId === environmentId,
                }}
                onPress={() => setSelectedEnvironmentId(environment.environmentId)}
                className={cn(
                  "rounded-full px-3 py-1.5",
                  environment.environmentId === environmentId
                    ? "bg-primary"
                    : "border border-border bg-card",
                )}
              >
                <Text
                  className={cn(
                    "text-sm font-t3-medium",
                    environment.environmentId === environmentId
                      ? "text-primary-foreground"
                      : "text-foreground-muted",
                  )}
                  numberOfLines={1}
                >
                  {environment.environmentLabel}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {environmentId === null ? (
          <SettingsSection title="Apps">
            <View className="px-4 py-6">
              <Text className="text-base text-foreground">Connect an environment first</Text>
              <Text className="mt-1 text-sm leading-normal text-foreground-muted">
                Apps are stored on the environment that runs your agents, so this list needs a
                connected environment.
              </Text>
            </View>
          </SettingsSection>
        ) : (
          <>
            <SettingsSection title="Connected apps">
              {connections.length === 0 ? (
                <View className="px-4 py-6">
                  <Text className="text-base text-foreground-muted">
                    No apps yet. Pick one below to give your agents Gmail, GitHub, Linear and more.
                  </Text>
                </View>
              ) : (
                connections.map((connection, index) => (
                  <AppRow
                    key={connection.id}
                    connection={connection}
                    status={appConnectionStatus(connection, apps.oauthClients)}
                    first={index === 0}
                    items={buildActions(connection)}
                    onToggle={(enabled) => void setEnabled(connection, enabled)}
                  />
                ))
              )}
            </SettingsSection>

            <SettingsSection title="Add an app">
              <View className="p-4">
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  onChangeText={setQuery}
                  placeholder="Search apps"
                  value={query}
                />
              </View>
              <CatalogActionRow
                icon="plus"
                label="Add custom MCP server"
                onPress={() => openAppEditor()}
              />
            </SettingsSection>

            {groups.map((group) => (
              <SettingsSection key={group.category} title={group.label}>
                {group.entries.map((entry, index) => (
                  <CatalogRow
                    key={entry.id}
                    entry={entry}
                    added={addedCatalogIds.has(entry.id)}
                    first={index === 0}
                    onPress={() => handleCatalogPress(entry)}
                  />
                ))}
              </SettingsSection>
            ))}

            <View className="gap-3">
              <SettingsSection title="OAuth clients">
                {APP_OAUTH_CLIENT_FAMILIES.map((family, index) => (
                  <CatalogActionRow
                    key={family.id}
                    first={index === 0}
                    icon="key"
                    label={family.name}
                    value={
                      apps.oauthClients[family.id] === undefined ? "Not configured" : "Configured"
                    }
                    onPress={() => openOAuthClient(family.id)}
                  />
                ))}
              </SettingsSection>
              <Text className="px-2 text-sm leading-normal text-foreground-muted">
                Google, GitHub, Slack and friends do not hand out OAuth clients automatically. Add
                one per family and every app in it can sign in.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function AppMonogram(props: {
  readonly name: string;
  readonly catalogId: string | null;
  readonly size?: number;
}) {
  const size = props.size ?? 34;
  return (
    <View
      className="items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: appAvatarColor(props.catalogId),
      }}
    >
      <Text className="font-t3-bold text-white" style={{ fontSize: size * 0.44 }}>
        {appMonogram(props.name)}
      </Text>
    </View>
  );
}

function AppRow(props: {
  readonly connection: AppConnection;
  readonly status: AppStatus;
  readonly first: boolean;
  readonly items: ReadonlyArray<{ readonly action: MenuAction; readonly run: () => void }>;
  readonly onToggle: (enabled: boolean) => void;
}) {
  const { connection, status } = props;
  return (
    <AnchoredMenu
      actions={props.items.map((item) => item.action)}
      title={connection.name}
      onPressAction={(event) => {
        props.items.find((item) => item.action.id === event.nativeEvent.event)?.run();
      }}
    >
      {(open) => (
        <View
          className={cn(
            "flex-row items-center gap-3 p-4",
            props.first ? undefined : "border-t border-border",
          )}
        >
          <Pressable
            accessibilityLabel={`${connection.name} actions`}
            accessibilityRole="button"
            className="min-w-0 flex-1 flex-row items-center gap-3"
            onPress={open}
          >
            <AppMonogram name={connection.name} catalogId={connection.catalogId} />
            <View className="min-w-0 flex-1">
              <Text className="text-base text-foreground" numberOfLines={1}>
                {connection.name}
              </Text>
              <Text className="text-sm text-foreground-muted" numberOfLines={1}>
                @{connection.slug}
              </Text>
              <Text
                className={cn(
                  "text-sm",
                  status.tone === "connected"
                    ? "text-emerald-500"
                    : status.tone === "error"
                      ? "text-danger-foreground"
                      : "text-foreground-muted",
                )}
                numberOfLines={2}
              >
                {status.label}
              </Text>
            </View>
          </Pressable>
          <ThemedSwitch value={connection.enabled} onValueChange={props.onToggle} />
        </View>
      )}
    </AnchoredMenu>
  );
}

function CatalogRow(props: {
  readonly entry: AppCatalogEntry;
  readonly added: boolean;
  readonly first: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      className={cn(
        "flex-row items-center gap-3 p-4",
        props.first ? undefined : "border-t border-border",
      )}
    >
      <AppMonogram name={props.entry.name} catalogId={props.entry.id} size={30} />
      <View className="min-w-0 flex-1">
        <Text className="text-base text-foreground" numberOfLines={1}>
          {props.entry.name}
        </Text>
        <Text className="text-sm text-foreground-muted" numberOfLines={2}>
          {props.entry.description}
        </Text>
      </View>
      {props.added ? <Text className="text-sm text-foreground-muted">Added</Text> : null}
    </Pressable>
  );
}

function CatalogActionRow(props: {
  readonly first?: boolean;
  readonly icon: Parameters<typeof SymbolView>[0]["name"];
  readonly label: string;
  readonly value?: string;
  readonly onPress: () => void;
}) {
  const iconColor = useThemeColor("--color-icon");
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      className={cn(
        "flex-row items-center gap-4 p-4",
        props.first === true ? undefined : "border-t border-border",
      )}
    >
      <SymbolView
        name={props.icon}
        size={22}
        tintColor={iconColor}
        type="monochrome"
        weight="regular"
      />
      <Text className="min-w-0 flex-1 text-lg text-foreground" numberOfLines={1}>
        {props.label}
      </Text>
      {props.value ? <Text className="text-base text-foreground-muted">{props.value}</Text> : null}
    </Pressable>
  );
}
