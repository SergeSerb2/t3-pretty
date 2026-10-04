import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AppConnectionId,
  findAppCatalogEntry,
  type AppAuthKind,
  type AppConnection,
  type AppsSettings,
  type EnvironmentId,
} from "@t3tools/contracts";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Alert, Linking, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { uuidv4 } from "../../lib/uuid";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentServerConfig } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ConnectionSheetButton } from "../connection/ConnectionSheetButton";
import { useGlassChromeActive } from "../scenery/SceneryProvider";
import { SettingsSection } from "./components/SettingsSection";
import {
  isValidAppSlug,
  normalizeAppSlug,
  sortedAppConnections,
  uniqueAppSlug,
} from "./apps/appsSettings.logic";
import { SheetSurface } from "../../components/SheetSurface";
import { GLASS_INPUT_CLASS_NAME } from "../scenery/GroupedCard";

type SettingsAppEditParams = {
  readonly environmentId: string;
  readonly connectionId?: string;
};

const AUTH_OPTIONS: ReadonlyArray<{ readonly kind: AppAuthKind; readonly label: string }> = [
  { kind: "oauth", label: "OAuth" },
  { kind: "token", label: "API token" },
  { kind: "none", label: "None" },
];

const URL_PATTERN = /^https?:\/\/\S+$/;

/**
 * One editor for both halves of "an app the server cannot fill in itself":
 * adding a custom MCP server, and setting the token or URL of a stored record.
 */
export function SettingsAppEditRouteScreen({ route }: StaticScreenProps<SettingsAppEditParams>) {
  const environmentId = route.params.environmentId as EnvironmentId;
  const connectionId = route.params.connectionId;
  const serverConfig = useEnvironmentServerConfig(environmentId);
  const apps = serverConfig?.settings.apps ?? null;
  const existing =
    connectionId === undefined || apps === null
      ? undefined
      : apps.connections[connectionId as AppConnectionId];

  // The form seeds its fields once, so it must not mount before the settings
  // stream has produced the record it is editing.
  if (connectionId !== undefined && (apps === null || existing === undefined)) {
    return (
      <SheetSurface>
        <NativeStackScreenOptions options={{ title: "App" }} />
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerClassName="px-5 pt-6"
        >
          <Text className="text-base text-foreground-muted">
            {apps === null ? "Waiting for this environment…" : "This app is no longer available."}
          </Text>
        </ScrollView>
      </SheetSurface>
    );
  }

  return (
    <AppEditor
      apps={apps ?? { connections: {}, oauthClients: {} }}
      environmentId={environmentId}
      existing={existing}
    />
  );
}

function AppEditor(props: {
  readonly apps: AppsSettings;
  readonly environmentId: EnvironmentId;
  readonly existing: AppConnection | undefined;
}) {
  const { apps, environmentId, existing } = props;
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const glass = useGlassChromeActive();
  const inputClassName = glass ? GLASS_INPUT_CLASS_NAME : undefined;
  const catalogEntry = findAppCatalogEntry(existing?.catalogId);
  const tokenHelpUrl = catalogEntry?.tokenHelpUrl;

  const [name, setName] = useState(existing?.name ?? "");
  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(existing !== undefined);
  const [url, setUrl] = useState(existing?.url ?? "");
  const [auth, setAuth] = useState<AppAuthKind>(existing?.auth ?? "oauth");
  const [token, setToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const upsert = useAtomCommand(serverEnvironment.appsUpsert, { reportFailure: false });
  const setTokenCommand = useAtomCommand(serverEnvironment.appsSetToken, { reportFailure: false });

  const takenSlugs = useMemo(
    () =>
      sortedAppConnections(apps)
        .filter((connection) => connection.id !== existing?.id)
        .map((connection) => connection.slug),
    [apps, existing?.id],
  );
  const effectiveSlug = slugTouched ? slug : normalizeAppSlug(name);
  const slugValid = effectiveSlug !== "" && isValidAppSlug(effectiveSlug);
  const canSave = name.trim().length > 0 && slugValid && URL_PATTERN.test(url.trim()) && !isSaving;

  const reportFailure = useCallback(
    (title: string, result: AtomCommandResult<unknown, unknown>) => {
      if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
      const error = squashAtomCommandFailure(result);
      Alert.alert(title, error instanceof Error ? error.message : "An error occurred.");
    },
    [],
  );

  const save = useCallback(async () => {
    setIsSaving(true);
    try {
      const id = existing?.id ?? AppConnectionId.make(uuidv4());
      const result = await upsert({
        environmentId,
        input: {
          connection: {
            id,
            catalogId: existing?.catalogId ?? null,
            name: name.trim(),
            slug: uniqueAppSlug(effectiveSlug, takenSlugs),
            url: url.trim(),
            auth,
            scopes: existing?.scopes ?? "",
            tokenHeader: existing?.tokenHeader ?? "Authorization",
            enabled: existing?.enabled ?? true,
          },
        },
      });
      if (result._tag !== "Success") {
        reportFailure("Couldn't save app", result);
        return;
      }
      if (auth === "token" && token.trim().length > 0) {
        const tokenResult = await setTokenCommand({
          environmentId,
          input: { connectionId: id, token: token.trim() },
        });
        if (tokenResult._tag !== "Success") {
          reportFailure("Couldn't store token", tokenResult);
          return;
        }
      }
      navigation.goBack();
    } finally {
      setIsSaving(false);
    }
  }, [
    auth,
    effectiveSlug,
    environmentId,
    existing,
    name,
    navigation,
    reportFailure,
    setTokenCommand,
    takenSlugs,
    token,
    upsert,
    url,
  ]);

  return (
    <SheetSurface>
      <NativeStackScreenOptions
        options={{ title: existing === undefined ? "Custom MCP server" : existing.name }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentInset={{ bottom: Math.max(insets.bottom, 18) }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4 pb-[18px]"
      >
        <SettingsSection title="Server">
          <View className="gap-4 p-4">
            <Field label="Name">
              <TextInput
                className={inputClassName}
                autoCapitalize="words"
                autoCorrect={false}
                onChangeText={setName}
                placeholder="My MCP server"
                value={name}
              />
            </Field>
            <Field
              label="Slug"
              hint={
                slugValid || effectiveSlug === ""
                  ? "Agents see this as @slug and mcp__slug__tool."
                  : "Lower-case letters, numbers, - and _, up to 32 characters."
              }
              invalid={!slugValid && effectiveSlug !== ""}
            >
              <TextInput
                className={inputClassName}
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={(value) => {
                  setSlugTouched(true);
                  setSlug(value);
                }}
                placeholder="my-server"
                value={effectiveSlug}
              />
            </Field>
            <Field label="URL" hint="Streamable HTTP MCP endpoint.">
              <TextInput
                className={inputClassName}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                onChangeText={setUrl}
                placeholder="https://mcp.example.com/mcp"
                value={url}
              />
            </Field>
            <Field label="Authentication">
              <View className="flex-row gap-2">
                {AUTH_OPTIONS.map((option) => (
                  <Pressable
                    key={option.kind}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.kind === auth }}
                    onPress={() => setAuth(option.kind)}
                    className={cn(
                      "flex-1 items-center rounded-[14px] py-3",
                      option.kind === auth
                        ? "bg-primary"
                        : glass
                          ? "border-[0.5px] border-chrome-glass-border bg-foreground/5"
                          : "border border-border bg-secondary",
                    )}
                  >
                    <Text
                      className={cn(
                        "text-sm font-t3-medium",
                        option.kind === auth
                          ? "text-primary-foreground"
                          : "text-secondary-foreground",
                      )}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </Field>
            {auth === "token" ? (
              <Field label="API token" hint="Stored on the environment, never on this device.">
                <TextInput
                  className={inputClassName}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={setToken}
                  placeholder={
                    existing?.authorizedAt == null
                      ? "Paste your token"
                      : "Stored — enter to replace"
                  }
                  secureTextEntry
                  value={token}
                />
              </Field>
            ) : null}
            <ConnectionSheetButton
              disabled={!canSave}
              icon="checkmark"
              label={isSaving ? "Saving…" : "Save"}
              tone="primary"
              onPress={() => void save()}
            />
          </View>
        </SettingsSection>

        {tokenHelpUrl ? (
          <Pressable
            accessibilityRole="link"
            className="px-2"
            onPress={() => void Linking.openURL(tokenHelpUrl)}
          >
            <Text className="text-sm text-primary">
              Where do I get a {catalogEntry?.name} token?
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SheetSurface>
  );
}

function Field(props: {
  readonly label: string;
  readonly hint?: string;
  readonly invalid?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
        {props.label}
      </Text>
      {props.children}
      {props.hint ? (
        <Text
          className={cn(
            "text-xs leading-normal",
            props.invalid === true ? "text-danger-foreground" : "text-foreground-muted",
          )}
        >
          {props.hint}
        </Text>
      ) : null}
    </View>
  );
}
