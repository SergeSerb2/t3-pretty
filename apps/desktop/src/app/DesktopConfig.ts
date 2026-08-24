import { ADVERTISED_ENDPOINT_URL_MAX_LENGTH } from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Option from "effect/Option";

const trimNonEmptyOption = (value: string): Option.Option<string> => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
};

const trimmedString = (name: string) =>
  Config.string(name).pipe(Config.option, Config.map(Option.flatMap(trimNonEmptyOption)));

const optionalBoolean = (name: string) =>
  Config.boolean(name).pipe(Config.option, Config.map(Option.getOrElse(() => false)));

export const DESKTOP_HTTPS_ENDPOINTS_MAX_ITEMS = 32;

const splitBoundedCommaSeparatedStrings = (
  value: string,
  options: { readonly maxItems: number; readonly maxItemLength: number },
): readonly string[] => {
  const entries: string[] = [];
  let offset = 0;

  // Count every segment, including empty or oversized ones, so an input made
  // only of delimiters cannot bypass the work budget.
  for (let index = 0; index < options.maxItems && offset <= value.length; index += 1) {
    const separator = value.indexOf(",", offset);
    const end = separator === -1 ? value.length : separator;
    if (end - offset <= options.maxItemLength) {
      const entry = value.slice(offset, end).trim();
      if (entry.length > 0 && entry.length <= options.maxItemLength) {
        entries.push(entry);
      }
    }

    if (separator === -1) break;
    offset = separator + 1;
  }

  return entries;
};

const commaSeparatedStrings = (
  name: string,
  options: { readonly maxItems: number; readonly maxItemLength: number },
) =>
  trimmedString(name).pipe(
    Config.map(
      Option.match({
        onNone: () => [],
        onSome: (value) => splitBoundedCommaSeparatedStrings(value, options),
      }),
    ),
  );

const compactEnv = (env: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

export const DesktopConfig = Config.all({
  appDataDirectory: trimmedString("APPDATA"),
  xdgConfigHome: trimmedString("XDG_CONFIG_HOME"),
  xdgDataHome: trimmedString("XDG_DATA_HOME"),
  t3Home: trimmedString("T3CODE_HOME"),
  devServerUrl: Config.url("VITE_DEV_SERVER_URL").pipe(Config.option),
  appUserModelIdOverride: trimmedString("T3CODE_DESKTOP_APP_USER_MODEL_ID"),
  devRemoteT3ServerEntryPath: trimmedString("T3CODE_DEV_REMOTE_T3_SERVER_ENTRY_PATH"),
  configuredBackendPort: Config.port("T3CODE_PORT").pipe(Config.option),
  commitHashOverride: trimmedString("T3CODE_COMMIT_HASH"),
  desktopLanHostOverride: trimmedString("T3CODE_DESKTOP_LAN_HOST"),
  desktopHttpsEndpointUrls: commaSeparatedStrings("T3CODE_DESKTOP_HTTPS_ENDPOINTS", {
    maxItems: DESKTOP_HTTPS_ENDPOINTS_MAX_ITEMS,
    maxItemLength: ADVERTISED_ENDPOINT_URL_MAX_LENGTH,
  }),
  otlpTracesUrl: trimmedString("T3CODE_OTLP_TRACES_URL"),
  otlpExportIntervalMs: Config.int("T3CODE_OTLP_EXPORT_INTERVAL_MS").pipe(
    Config.withDefault(10_000),
  ),
  appImagePath: trimmedString("APPIMAGE"),
  disableAutoUpdate: optionalBoolean("T3CODE_DISABLE_AUTO_UPDATE"),
  mockUpdates: optionalBoolean("T3CODE_DESKTOP_MOCK_UPDATES"),
  mockUpdateServerPort: Config.port("T3CODE_DESKTOP_MOCK_UPDATE_SERVER_PORT").pipe(
    Config.withDefault(3000),
  ),
});

export const layerTest = (env: Readonly<Record<string, string | undefined>>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: compactEnv(env) }));
