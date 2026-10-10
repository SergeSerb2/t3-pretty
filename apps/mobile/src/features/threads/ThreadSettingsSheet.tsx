import { createV5StackNavigator as createNativeStackNavigator } from "../../native/createV5StackNavigator";
import type {
  EnvironmentId,
  ModelSelection,
  ProviderInstanceId,
  ProviderInteractionMode,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  RuntimeMode,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { displayRuntimeModeForProviderDriver } from "@t3tools/contracts";

import type { LegendListRenderItemProps } from "@legendapp/list/react-native";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import { CONNECT_BRANDING } from "@t3tools/shared/connectBranding";
import { usesChatGptSharing } from "@t3tools/shared/usageLimits";
import { StackActions, useNavigation } from "@react-navigation/native";
import { type NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
import { AsyncResult } from "effect/reactivity";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { MaterialIconButton } from "../../components/MaterialIconButton";
import { ProviderIcon } from "../../components/ProviderIcon";
import { SheetSurface } from "../../components/SheetSurface";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { cn } from "../../lib/cn";
import { MOTION_TIMING } from "../../lib/motion";
import { limitMobileSearchQuery, MOBILE_TEXT_SEARCH_QUERY_MAX_LENGTH } from "../../lib/searchQuery";
import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import { applyProviderOptionSelection } from "../../lib/providerOptions";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import {
  NativeHeaderToolbar,
  NativeStackScreenOptions,
  nativeHeaderScrollEdgeEffects,
} from "../../native/StackHeader";
import {
  NATIVE_LIQUID_GLASS_SUPPORTED,
  TRANSPARENT_NATIVE_HEADERS,
} from "../../native/native-glass";
import { GlassRowPressable } from "../scenery/GroupedCard";
import { GLASS_CARD_CLASS_NAME, glassCardStyle } from "../scenery/glassStyles";
import { useGlassChromeActive } from "../scenery/SceneryProvider";
import { ChatGptSharingStatus } from "./ChatGptSharingStatus";
import { environmentServerConfigsAtom, serverEnvironment } from "../../state/server";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  createProviderCatalogRefreshRunner,
  providerCatalogRefreshError,
} from "./provider-catalog-refresh";
import {
  createNativeMailSearchToolbarItem,
  NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET,
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED,
} from "../layout/native-mail-search-toolbar";
import { useNativeMailSearchToolbar } from "../../native/use-native-mail-search-toolbar";
import { ThreadSettingsControlStack } from "./ThreadSettingsControls";
import { ModelRow } from "./ThreadSettingsRows";
import {
  compatibleRuntimeModeForChoices,
  runtimeModeChoicesForSupportedModes,
} from "./thread-settings-options";
import { useNewTaskFlow } from "./new-task-flow-provider";
import { buildThreadModelIdentity } from "./threadModelIdentity";
import { ThreadCheckpointsSection } from "./ThreadCheckpointsSection";
import { useProjectTransferAction } from "./use-project-transfer";
import {
  buildNewTaskThreadSettingsSession,
  effectiveProviderFilter,
  favoritesFirst,
  initialProviderFilter,
  modelFavoriteKey,
  modelMatchesCatalogQuery,
  providerSectionIsCollapsed,
  toggleModelFavorite,
  visibleSheetOptionDescriptors,
} from "./thread-settings-sheet-state";
import { formatProviderUpdateRequiredNotice } from "@t3tools/client-runtime/providerUpdateRequiredModels";

/**
 * Everyday harnesses start expanded; every other provider (OpenRouter catalogs
 * and friends) starts folded so a 300-model catalog cannot bury the list. All
 * provider headers remain user-collapsible.
 */
const PRIMARY_PROVIDER_DRIVERS: ReadonlySet<string> = new Set([
  "claudeAgent",
  "codex",
  "antigravity",
]);
/**
 * Keep measured row changes stable, but let catalog mutations use the list's
 * native bounds so a filtered catalog that underflows returns to the top.
 */
const THREAD_SETTINGS_MAINTAIN_VISIBLE_CONTENT_POSITION = {
  data: false,
  size: true,
} as const;
const THREAD_SETTINGS_CATALOG_LAYOUT_TRANSITION = LinearTransition.duration(180);
const THREAD_SETTINGS_CATALOG_ENTER_TRANSITION = FadeIn.duration(140);
const THREAD_SETTINGS_CATALOG_EXIT_TRANSITION = FadeOut.duration(120);
const THREAD_SETTINGS_HEADER_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(
  Platform.OS,
  Platform.Version,
);
const DISCLOSURE_CHEVRON_TIMING = { ...MOTION_TIMING, duration: 180 };

export function threadSettingsSummaryLabel(input: {
  readonly modelLabel: string;
  readonly optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
  readonly providerDriver?: string | null;
}): string {
  const identity = buildThreadModelIdentity({
    modelLabel: input.modelLabel,
    providerDriver: null,
    optionDescriptors: input.optionDescriptors,
  });
  const runtime = runtimeModeChoicesForSupportedModes(undefined).find(
    (choice) =>
      choice.mode === displayRuntimeModeForProviderDriver(input.providerDriver, input.runtimeMode),
  );
  return [
    identity.summary,
    ...(runtime ? [runtime.shortLabel] : []),
    ...(input.interactionMode === "plan" ? ["Plan"] : []),
  ].join(" · ");
}

const EMPTY_MODEL_FAVORITES: ReadonlyArray<{
  readonly provider: ProviderInstanceId;
  readonly model: string;
}> = [];
const FAVORITES_PROVIDER_FILTER = "@favorites";
/**
 * Chevron that turns between collapsed and expanded instead of swapping
 * glyphs. A recycled header rebinding to another `identity` snaps.
 */
function DisclosureChevron(props: { readonly expanded: boolean; readonly identity: string }) {
  const rotation = useSharedValue(props.expanded ? 180 : 0);
  const identity = useRef(props.identity);
  // Before paint, so a recycled header never shows its old angle for a frame.
  useLayoutEffect(() => {
    const target = props.expanded ? 180 : 0;
    rotation.set(
      identity.current === props.identity ? withTiming(target, DISCLOSURE_CHEVRON_TIMING) : target,
    );
    identity.current = props.identity;
  }, [props.expanded, props.identity, rotation]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.get()}deg` }] }));
  return (
    <Animated.View style={style}>
      <SymbolView
        name="chevron.down"
        size={12}
        tintColorClassName="accent-icon-subtle"
        type="monochrome"
      />
    </Animated.View>
  );
}

/** Provider catalog header with its harness logo and disclosure state. */
function ProviderHeader(props: {
  readonly providerKey: string;
  readonly driver: string | undefined;
  readonly iconUrl: string | undefined;
  readonly label: string;
  readonly collapsible: boolean;
  readonly collapsed: boolean;
  readonly modelCount: number;
  readonly onToggle: () => void;
}) {
  const glass = useGlassChromeActive();
  const content = (
    <>
      <ProviderIcon iconUrl={props.iconUrl} provider={props.driver} size={15} />
      <Text className="text-sm font-t3-medium text-foreground-muted">{props.label}</Text>
      {props.collapsible ? (
        <>
          <View className="flex-1" />
          {props.collapsed ? (
            <Text className="text-2xs font-t3-medium text-foreground-muted">
              {props.modelCount}
            </Text>
          ) : null}
          {glass ? (
            <DisclosureChevron expanded={!props.collapsed} identity={props.providerKey} />
          ) : (
            <SymbolView
              name={props.collapsed ? "chevron.down" : "chevron.up"}
              size={12}
              tintColorClassName="accent-icon-subtle"
              type="monochrome"
            />
          )}
        </>
      ) : null}
    </>
  );

  if (props.collapsible) {
    return (
      <Pressable
        accessibilityLabel={`${props.label}, ${props.modelCount} models`}
        accessibilityRole="button"
        accessibilityState={{ expanded: !props.collapsed }}
        className="mx-4 mt-1 min-h-11 flex-row items-center gap-2 rounded-xl px-1 pt-2 active:opacity-60 android:min-h-12"
        onPress={props.onToggle}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View accessibilityRole="header" className="mx-4 min-h-9 flex-row items-center gap-2 px-1 pt-1">
      {content}
    </View>
  );
}

/** Compact row that opens a single-choice submenu panel. */
function DisclosureRow(props: {
  readonly label: string;
  readonly value: string | undefined;
  readonly onPress: () => void;
  readonly isLast?: boolean;
  readonly disabled?: boolean;
}) {
  return (
    <GlassRowPressable
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn(
        "min-h-11 flex-row items-center gap-2 px-5 py-2.5",
        props.disabled && "opacity-55",
      )}
      fallbackClassName="active:opacity-70"
    >
      <Text className="text-sm font-t3-medium text-foreground">{props.label}</Text>
      <View className="flex-1" />
      {props.value ? (
        <Text className="text-sm text-foreground-muted" numberOfLines={1}>
          {props.value}
        </Text>
      ) : null}
      <SymbolView
        name="chevron.right"
        size={12}
        tintColorClassName="accent-icon-subtle"
        type="monochrome"
      />
    </GlassRowPressable>
  );
}

function SwitchRow(props: {
  readonly label: string;
  readonly value: boolean;
  readonly onValueChange: (value: boolean) => void;
  readonly isLast?: boolean;
}) {
  return (
    <View className="min-h-11 flex-row items-center justify-between px-5 py-2.5">
      <Text className="text-sm font-t3-medium text-foreground">{props.label}</Text>
      <ThemedSwitch
        accessibilityLabel={props.label}
        onValueChange={props.onValueChange}
        value={props.value}
      />
    </View>
  );
}

function FilterChip(props: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
}) {
  const glass = useGlassChromeActive();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      className={cn(
        "h-8 justify-center rounded-full px-3",
        props.selected
          ? "bg-primary"
          : glass
            ? "border border-chrome-glass-border bg-chrome-glass"
            : "bg-card",
      )}
      style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}
      onPress={props.onPress}
    >
      <Text
        className={cn(
          "text-xs font-t3-medium",
          props.selected ? "text-primary-foreground" : "text-foreground",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

type ThreadSettingsSessionProps = {
  readonly environmentId: EnvironmentId | null;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly selectedModel: ModelSelection | null;
  readonly reportedModelSelection?: ModelSelection | null;
  readonly onSelectModel: (option: ModelOption) => void;
  readonly optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly onUpdateOptionSelections: (selections: ReadonlyArray<ProviderOptionSelection>) => void;
  readonly runtimeMode: RuntimeMode;
  readonly onUpdateRuntimeMode: (mode: RuntimeMode) => void;
  /** Existing-thread sessions only: enables the Checkpoints card with its
      per-checkpoint revert action. Absent in the new-task flow. */
  readonly checkpointsThreadRef?: ScopedThreadRef | null;
};

export type ExistingThreadSettingsRouteSession = ThreadSettingsSessionProps & {
  readonly ownerId: string;
};

type ExistingThreadSettingsRouteContextValue = {
  readonly session: ExistingThreadSettingsRouteSession | null;
  readonly present: (session: ExistingThreadSettingsRouteSession) => void;
  readonly clear: (ownerId: string) => void;
};

const ExistingThreadSettingsRouteContext =
  createContext<ExistingThreadSettingsRouteContextValue | null>(null);

/** Bridges the active thread's settings state into the root native sheet route. */
export function ExistingThreadSettingsRouteProvider(props: { readonly children: ReactNode }) {
  const [session, setSession] = useState<ExistingThreadSettingsRouteSession | null>(null);
  const clear = useCallback((ownerId: string) => {
    setSession((current) => (current?.ownerId === ownerId ? null : current));
  }, []);
  const value = useMemo(() => ({ session, present: setSession, clear }), [clear, session]);

  return (
    <ExistingThreadSettingsRouteContext.Provider value={value}>
      {props.children}
    </ExistingThreadSettingsRouteContext.Provider>
  );
}

export function useExistingThreadSettingsRoutePresentation() {
  const value = use(ExistingThreadSettingsRouteContext);
  if (!value) {
    throw new Error(
      "useExistingThreadSettingsRoutePresentation must be used inside ExistingThreadSettingsRouteProvider.",
    );
  }
  return value;
}

type ThreadSettingsSessionValue = {
  readonly environmentId: EnvironmentId | null;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly favoriteKeys: ReadonlySet<string>;
  readonly favoritesLoaded: boolean;
  readonly toggleFavorite: (option: ModelOption) => void;
  readonly runtimeMode: RuntimeMode;
  readonly runtimeModeChoices: ReturnType<typeof runtimeModeChoicesForSupportedModes>;
  readonly onUpdateRuntimeMode: (mode: RuntimeMode) => void;
  readonly displayedDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly displayedModel: ModelOption | null;
  readonly displayedModelSelection: ModelSelection | null;
  readonly reportedModelSelection: ModelSelection | null;
  readonly providerExpansionOverrides: ReadonlySet<string>;
  readonly hasLegacyModels: boolean;
  readonly checkpointsThreadRef: ScopedThreadRef | null;
  readonly providerFilter: string | null;
  readonly searchQuery: string;
  readonly showLegacy: boolean;
  readonly applyOptionChange: (id: string, value: string | boolean) => void;
  readonly isApplied: (option: ModelOption) => boolean;
  readonly pressModel: (option: ModelOption) => void;
  readonly setProviderFilter: (providerKey: string | null) => void;
  readonly setSearchQuery: (query: string) => void;
  readonly setShowLegacy: (showLegacy: boolean) => void;
  readonly toggleProvider: (providerKey: string) => void;
};

const ThreadSettingsSessionContext = createContext<ThreadSettingsSessionValue | null>(null);

/**
 * Owns catalog browsing state for one picker presentation. Every model,
 * option, and runtime pick applies immediately; there is nothing to save.
 */
function ThreadSettingsSessionProvider(
  props: ThreadSettingsSessionProps & { readonly children: ReactNode },
) {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const favoritesLoaded = AsyncResult.isSuccess(preferences);
  const modelFavorites = favoritesLoaded
    ? (preferences.value.modelFavorites ?? EMPTY_MODEL_FAVORITES)
    : EMPTY_MODEL_FAVORITES;
  const favoriteKeys = useMemo(
    () =>
      new Set(
        modelFavorites.map((favorite) => modelFavoriteKey(favorite.provider, favorite.model)),
      ),
    [modelFavorites],
  );
  const toggleFavorite = useCallback(
    (option: ModelOption) => {
      if (!favoritesLoaded) return;
      void Haptics.selectionAsync();
      savePreferences({
        transform: (current) => ({
          modelFavorites: toggleModelFavorite(
            current.modelFavorites ?? EMPTY_MODEL_FAVORITES,
            option,
          ),
        }),
      });
    },
    [favoritesLoaded, savePreferences],
  );
  const [showLegacyToggle, setShowLegacyToggle] = useState(false);
  const [providerFilter, setProviderFilter] = useState<string | null>(() =>
    initialProviderFilter({
      providerGroups: props.providerGroups,
      selectedModel: props.selectedModel,
    }),
  );
  const [searchQuery, setSearchQueryState] = useState("");
  const setSearchQuery = useCallback((query: string) => {
    setSearchQueryState(limitMobileSearchQuery(query, MOBILE_TEXT_SEARCH_QUERY_MAX_LENGTH));
  }, []);
  const [providerExpansionOverrides, setProviderExpansionOverrides] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const isApplied = useCallback(
    (option: ModelOption) =>
      option.selection.instanceId === props.selectedModel?.instanceId &&
      option.selection.model === props.selectedModel.model,
    [props.selectedModel],
  );
  const displayedModel = useMemo(
    () =>
      props.providerGroups.flatMap((group) => group.models).find((option) => isApplied(option)) ??
      null,
    [isApplied, props.providerGroups],
  );
  const runtimeModeChoices = runtimeModeChoicesForSupportedModes(
    displayedModel?.supportedRuntimeModes,
  );
  const compatibleRuntimeMode = compatibleRuntimeModeForChoices(
    props.runtimeMode,
    runtimeModeChoices,
  );

  const visibleDescriptors = useMemo(
    () => visibleSheetOptionDescriptors(props.optionDescriptors),
    [props.optionDescriptors],
  );

  const hasLegacyModels = useMemo(
    () => props.providerGroups.some((group) => group.models.some((model) => model.isLegacy)),
    [props.providerGroups],
  );

  const applyOptionChange = useCallback(
    (id: string, value: string | boolean) => {
      const next = applyProviderOptionSelection(props.optionDescriptors, { id, value });
      if (next) {
        void Haptics.selectionAsync();
        props.onUpdateOptionSelections(next);
      }
    },
    [props.optionDescriptors, props.onUpdateOptionSelections],
  );

  const toggleProvider = useCallback((providerKey: string) => {
    setProviderExpansionOverrides((current) => {
      const next = new Set(current);
      if (!next.delete(providerKey)) {
        next.add(providerKey);
      }
      return next;
    });
  }, []);

  // Re-tapping the applied model must not reset its options to catalog defaults.
  const pressModel = useCallback(
    (option: ModelOption) => {
      if (isApplied(option)) {
        return;
      }
      if (option.isUnavailable) {
        Alert.alert(
          "Model unavailable",
          "Set up this provider on web or desktop, or select another model.",
        );
        return;
      }
      void Haptics.selectionAsync();
      props.onSelectModel(option);
    },
    [isApplied, props.onSelectModel],
  );

  const value = useMemo<ThreadSettingsSessionValue>(
    () => ({
      environmentId: props.environmentId,
      providerInstanceId: props.providerInstanceId,
      providerGroups: props.providerGroups,
      runtimeMode: compatibleRuntimeMode,
      onUpdateRuntimeMode: props.onUpdateRuntimeMode,
      runtimeModeChoices,
      displayedDescriptors: visibleDescriptors,
      displayedModel,
      displayedModelSelection: props.selectedModel,
      reportedModelSelection: props.reportedModelSelection ?? null,
      favoriteKeys,
      favoritesLoaded,
      providerExpansionOverrides,
      hasLegacyModels,
      checkpointsThreadRef: props.checkpointsThreadRef ?? null,
      providerFilter,
      searchQuery,
      showLegacy: showLegacyToggle,
      applyOptionChange,
      isApplied,
      pressModel,
      setProviderFilter,
      setSearchQuery,
      setShowLegacy: setShowLegacyToggle,
      toggleProvider,
      toggleFavorite,
    }),
    [
      applyOptionChange,
      visibleDescriptors,
      displayedModel,
      compatibleRuntimeMode,
      favoriteKeys,
      favoritesLoaded,
      providerExpansionOverrides,
      hasLegacyModels,
      props.checkpointsThreadRef,
      isApplied,
      props.environmentId,
      props.selectedModel,
      props.reportedModelSelection,
      props.providerInstanceId,
      pressModel,
      providerFilter,
      props.onUpdateRuntimeMode,
      props.providerGroups,
      runtimeModeChoices,
      searchQuery,
      showLegacyToggle,
      toggleProvider,
      toggleFavorite,
    ],
  );

  return (
    <ThreadSettingsSessionContext.Provider value={value}>
      {props.children}
    </ThreadSettingsSessionContext.Provider>
  );
}

function useThreadSettingsSession() {
  const value = use(ThreadSettingsSessionContext);
  if (!value) {
    throw new Error("useThreadSettingsSession must be used inside ThreadSettingsSessionProvider.");
  }
  return value;
}

/** Scenery key of the thread being configured; new tasks have none. */
function useThreadSettingsSceneryKey(): string | null {
  const threadRef = useThreadSettingsSession().checkpointsThreadRef;
  return threadRef === null ? null : `${threadRef.environmentId}:${threadRef.threadId}`;
}

type ThreadSettingsProviderCatalog = {
  readonly key: string;
  readonly driver: string | undefined;
  readonly iconUrl: string | undefined;
  readonly label: string;
  readonly collapsible: boolean;
  readonly collapsed: boolean;
  readonly modelCount: number;
  readonly models: ReadonlyArray<ModelOption>;
};

type ThreadSettingsCatalogItem =
  | {
      readonly kind: "provider";
      readonly key: string;
      readonly provider: ThreadSettingsProviderCatalog;
    }
  | {
      readonly kind: "model";
      readonly key: string;
      readonly option: ModelOption;
      readonly isFirst: boolean;
      readonly isLast: boolean;
    }
  | {
      readonly kind: "notice";
      readonly key: string;
      readonly text: string;
    }
  | {
      readonly kind: "empty";
      readonly key: "empty";
    };

function ThreadSettingsModelListRow(props: {
  readonly option: ModelOption;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}) {
  const session = useThreadSettingsSession();
  const navigation = useNavigation<NativeStackNavigationProp<ThreadSettingsPickerStackParams>>();
  const option = props.option;
  const pressModel = session.pressModel;
  const onPress = useCallback(() => {
    pressModel(option);
    if (!option.isUnavailable) navigation.goBack();
  }, [navigation, option, pressModel]);

  return (
    <ModelRow
      isFirst={props.isFirst}
      isLast={props.isLast}
      onPress={onPress}
      isFavorite={session.favoriteKeys.has(props.option.key)}
      favoritesLoaded={session.favoritesLoaded}
      onToggleFavorite={() => session.toggleFavorite(props.option)}
      option={props.option}
      selected={session.isApplied(props.option)}
    />
  );
}

function ThreadSettingsProviderListHeader(props: {
  readonly provider: ThreadSettingsProviderCatalog;
}) {
  const session = useThreadSettingsSession();
  const onToggle = useCallback(
    () => session.toggleProvider(props.provider.key),
    [props.provider.key, session.toggleProvider],
  );

  return (
    <ProviderHeader
      providerKey={props.provider.key}
      collapsible={props.provider.collapsible}
      collapsed={props.provider.collapsed}
      driver={props.provider.driver}
      iconUrl={props.provider.iconUrl}
      label={props.provider.label}
      modelCount={props.provider.modelCount}
      onToggle={onToggle}
    />
  );
}

function useThreadSettingsCatalogItems(
  session: ThreadSettingsSessionValue,
): ReadonlyArray<ThreadSettingsCatalogItem> {
  return useMemo(
    () =>
      session.providerGroups.flatMap((group) => {
        const activeProviderFilter = effectiveProviderFilter({
          providerFilter: session.providerFilter,
          searchQuery: session.searchQuery,
        });
        if (activeProviderFilter !== null && group.providerKey !== activeProviderFilter) {
          return [];
        }
        const driver = group.models[0]?.providerDriver ?? group.providerKey;
        const catalogModels =
          session.showLegacy || session.providerFilter === FAVORITES_PROVIDER_FILTER
            ? group.models
            : group.models.filter(
                (model) =>
                  !model.isLegacy ||
                  session.isApplied(model) ||
                  session.favoriteKeys.has(model.key),
              );
        const visibleModels = favoritesFirst(
          catalogModels.filter(
            (model) =>
              (session.providerFilter !== FAVORITES_PROVIDER_FILTER ||
                session.favoriteKeys.has(model.key)) &&
              modelMatchesCatalogQuery({
                model,
                providerLabel: group.providerLabel,
                query: session.searchQuery,
              }),
          ),
          session.favoriteKeys,
        );
        // Favorites list only selectable models, so it never explains gated ones.
        const updateRequiredNotice =
          group.updateRequired && session.providerFilter !== FAVORITES_PROVIDER_FILTER
            ? formatProviderUpdateRequiredNotice(group.updateRequired, session.searchQuery)
            : null;
        if (visibleModels.length === 0 && !updateRequiredNotice) {
          return [];
        }
        const containsDisplayedSelection = group.models.some(session.isApplied);
        const isNarrowed = activeProviderFilter !== null || session.searchQuery.trim().length > 0;
        const collapsible = !isNarrowed && session.providerGroups.length > 1;
        const collapsed = providerSectionIsCollapsed({
          defaultExpanded: containsDisplayedSelection || session.providerGroups.length === 1,
          hasExpansionOverride: session.providerExpansionOverrides.has(group.providerKey),
          isNarrowed,
        });
        const provider: ThreadSettingsProviderCatalog = {
          key: group.providerKey,
          driver,
          iconUrl: group.models[0]?.providerIconUrl,
          label: group.providerLabel,
          collapsible,
          collapsed,
          modelCount: visibleModels.length,
          models: collapsed ? [] : visibleModels,
        };
        return [
          {
            kind: "provider" as const,
            key: `provider:${group.providerKey}`,
            provider,
          },
          ...provider.models.map((option, index) => ({
            kind: "model" as const,
            key: `model:${option.key}`,
            option,
            isFirst: index === 0,
            isLast: index === provider.models.length - 1,
          })),
          ...(!collapsed && updateRequiredNotice
            ? [
                {
                  kind: "notice" as const,
                  key: `notice:${group.providerKey}`,
                  text: updateRequiredNotice,
                },
              ]
            : []),
        ];
      }),
    [
      session.isApplied,
      session.favoriteKeys,
      session.providerExpansionOverrides,
      session.providerFilter,
      session.providerGroups,
      session.searchQuery,
      session.showLegacy,
    ],
  );
}

/** Current model plus its reasoning, speed, and access cards. */
function ThreadSettingsOptions(props: { readonly onPressModel: () => void }) {
  const session = useThreadSettingsSession();
  const configs = useAtomValue(environmentServerConfigsAtom);
  const selectedProvider = session.environmentId
    ? (configs
        .get(session.environmentId)
        ?.providers.find((provider) => provider.instanceId === session.providerInstanceId) ?? null)
    : null;

  return (
    <ThreadSettingsControlStack
      descriptors={session.displayedDescriptors}
      model={session.displayedModel}
      modelFooter={
        usesChatGptSharing(selectedProvider) ? (
          <ChatGptSharingStatus provider={selectedProvider} />
        ) : undefined
      }
      runtimeMode={session.runtimeMode}
      runtimeModeChoices={session.runtimeModeChoices}
      onOptionChange={session.applyOptionChange}
      onPressModel={props.onPressModel}
      onRuntimeModeChange={session.onUpdateRuntimeMode}
    />
  );
}

type ThreadSettingsProjectTransfer = {
  readonly isPending: boolean;
  readonly pendingLabel: string;
  readonly onPress: () => void;
};

/** Existing-thread extras below the catalog: project transfer and checkpoints. */
function ThreadSettingsThreadSections(props: {
  readonly projectTransfer: ThreadSettingsProjectTransfer | undefined;
}) {
  const session = useThreadSettingsSession();
  const glass = useGlassChromeActive();
  return (
    <>
      {props.projectTransfer ? (
        <>
          <Text className="px-5 pb-2 pt-7 text-sm font-t3-medium text-foreground-muted">
            Project
          </Text>
          <View
            className={
              glass ? cn(GLASS_CARD_CLASS_NAME, "mx-4") : "mx-4 overflow-hidden rounded-2xl bg-card"
            }
            style={glass ? glassCardStyle() : undefined}
          >
            <DisclosureRow
              disabled={props.projectTransfer.isPending}
              label={
                props.projectTransfer.isPending
                  ? props.projectTransfer.pendingLabel
                  : "Copy or move to connection"
              }
              value={CONNECT_BRANDING.connectName}
              onPress={props.projectTransfer.onPress}
            />
          </View>
          <Text className="px-5 pt-2 text-xs leading-4 text-foreground-muted">
            Copy duplicates this thread. Move relocates the whole project and removes it from this
            machine.
          </Text>
        </>
      ) : null}
      {session.checkpointsThreadRef !== null ? (
        <ThreadCheckpointsSection threadRef={session.checkpointsThreadRef} />
      ) : null}
    </>
  );
}

/** The catalog gets its own page so changing models never scrolls past the options. */
function ThreadSettingsCatalog() {
  const session = useThreadSettingsSession();
  const glass = useGlassChromeActive();
  const sceneryKey = useThreadSettingsSceneryKey();
  const refreshProvidersCommand = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const refreshProviderCatalog = useMemo(
    () => createProviderCatalogRefreshRunner(refreshProvidersCommand),
    [refreshProvidersCommand],
  );
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const refreshProviders = useCallback(() => {
    if (!session.environmentId || isRefreshingProviders) return;
    setIsRefreshingProviders(true);
    void refreshProviderCatalog(session.environmentId).then((result) => {
      setIsRefreshingProviders(false);
      const error = providerCatalogRefreshError(result);
      if (error) Alert.alert("Could not refresh models", error);
    });
  }, [isRefreshingProviders, refreshProviderCatalog, session.environmentId]);
  const catalogItems = useThreadSettingsCatalogItems(session);
  const [animationsReady, setAnimationsReady] = useState(false);
  const insets = useSafeAreaInsets();
  const isSearching = session.searchQuery.trim().length > 0;
  // Unfavoriting the last model must not strand the list on an empty filter.
  const showsFavoritesChip =
    session.favoriteKeys.size > 0 || session.providerFilter === FAVORITES_PROVIDER_FILTER;
  const hasActiveCatalogFilter = session.providerFilter !== null || isSearching;
  // The floating mail toolbar overlays content outside UIKit's automatic safe-area insets.
  const bottomToolbarInset =
    Platform.OS === "ios" && NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED
      ? NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET
      : 0;
  const listItems = useMemo<ReadonlyArray<ThreadSettingsCatalogItem>>(
    () => (catalogItems.length === 0 ? [{ kind: "empty", key: "empty" }] : catalogItems),
    [catalogItems],
  );
  const renderCatalogItem = useCallback(
    (itemProps: LegendListRenderItemProps<ThreadSettingsCatalogItem>) => {
      const item = itemProps.item;
      let content: ReactNode;

      if (item.kind === "provider") {
        content = <ThreadSettingsProviderListHeader provider={item.provider} />;
      } else if (item.kind === "model") {
        content = (
          <ThreadSettingsModelListRow
            isFirst={item.isFirst}
            isLast={item.isLast}
            option={item.option}
          />
        );
      } else if (item.kind === "notice") {
        content = <Text className="mx-8 mt-2 text-xs text-foreground-muted">{item.text}</Text>;
      } else if (item.kind === "empty") {
        content = (
          <View className="items-center px-8 py-14">
            <Text className="text-center text-sm text-foreground-muted">
              {session.providerFilter === FAVORITES_PROVIDER_FILTER && !isSearching
                ? "No favorite models"
                : hasActiveCatalogFilter
                  ? "No matching models"
                  : "No available models"}
            </Text>
          </View>
        );
      }

      return (
        <Animated.View
          key={item.key}
          entering={animationsReady ? THREAD_SETTINGS_CATALOG_ENTER_TRANSITION : undefined}
          exiting={animationsReady ? THREAD_SETTINGS_CATALOG_EXIT_TRANSITION : undefined}
        >
          {content}
        </Animated.View>
      );
    },
    [animationsReady, hasActiveCatalogFilter, isSearching, session.providerFilter],
  );

  const list = (
    <AnimatedLegendList
      alwaysBounceVertical
      automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
      automaticallyAdjustsScrollIndicatorInsets
      className={glass ? "flex-1" : "flex-1 bg-sheet"}
      style={
        Platform.OS === "android"
          ? { width: "100%", maxWidth: 720, alignSelf: "center" }
          : undefined
      }
      contentContainerStyle={{
        paddingBottom: 24 + bottomToolbarInset + (Platform.OS === "ios" ? 0 : insets.bottom),
        paddingTop: 4,
      }}
      contentInsetAdjustmentBehavior="automatic"
      data={listItems}
      estimatedItemSize={Platform.OS === "android" ? 56 : 48}
      extraData={`${animationsReady}:${glass}`}
      getItemType={(item) => item.kind}
      itemLayoutAnimation={THREAD_SETTINGS_CATALOG_LAYOUT_TRANSITION}
      keyExtractor={(item) => item.key}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      maintainVisibleContentPosition={THREAD_SETTINGS_MAINTAIN_VISIBLE_CONTENT_POSITION}
      ListHeaderComponent={
        <>
          {Platform.OS === "android" ? (
            <View className="px-4 pb-1 pt-4">
              <View
                className="flex-row items-center rounded-full bg-input px-2"
                style={{ minHeight: 56 }}
              >
                <View pointerEvents="none" className="px-2">
                  <SymbolView
                    name="magnifyingglass"
                    size={24}
                    tintColorClassName="accent-icon-subtle"
                  />
                </View>
                <TextInput
                  accessibilityLabel="Find a model"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-w-0 flex-1 px-2 py-0 text-base text-foreground"
                  style={{ minHeight: 56, includeFontPadding: false, textAlignVertical: "center" }}
                  onChangeText={session.setSearchQuery}
                  placeholder="Find a model"
                  placeholderTextColorClassName="accent-placeholder"
                  selectionColorClassName="accent-focus/32"
                  cursorColorClassName="accent-focus"
                  selectionHandleColorClassName="accent-focus"
                  value={session.searchQuery}
                />
                {session.searchQuery.length > 0 ? (
                  <MaterialIconButton
                    accessibilityLabel="Clear model search"
                    icon="xmark"
                    onPress={() => session.setSearchQuery("")}
                  />
                ) : null}
              </View>
            </View>
          ) : null}
          {session.providerGroups.length > 1 || showsFavoritesChip ? (
            <ScrollView
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                gap: 8,
                paddingHorizontal: 16,
                paddingBottom: 10,
                paddingTop: 8,
              }}
            >
              <FilterChip
                label="All"
                selected={session.providerFilter === null}
                onPress={() => session.setProviderFilter(null)}
              />
              {showsFavoritesChip ? (
                <FilterChip
                  label="Favorites"
                  selected={session.providerFilter === FAVORITES_PROVIDER_FILTER}
                  onPress={() => session.setProviderFilter(FAVORITES_PROVIDER_FILTER)}
                />
              ) : null}
              {session.providerGroups.length > 1
                ? session.providerGroups.map((group) => (
                    <FilterChip
                      key={group.providerKey}
                      label={group.providerLabel}
                      selected={session.providerFilter === group.providerKey}
                      onPress={() => session.setProviderFilter(group.providerKey)}
                    />
                  ))
                : null}
            </ScrollView>
          ) : null}
        </>
      }
      ListFooterComponent={
        <>
          {Platform.OS !== "ios" && session.hasLegacyModels ? (
            <View className="mt-6">
              <View className="mx-4 overflow-hidden rounded-2xl bg-card">
                <SwitchRow
                  label="Legacy models"
                  onValueChange={session.setShowLegacy}
                  value={session.showLegacy}
                />
              </View>
            </View>
          ) : null}
        </>
      }
      recycleItems
      refreshControl={
        session.environmentId ? (
          <RefreshControl refreshing={isRefreshingProviders} onRefresh={refreshProviders} />
        ) : undefined
      }
      onLoad={() => setAnimationsReady(true)}
      renderItem={renderCatalogItem}
      showsVerticalScrollIndicator={false}
    />
  );
  return glass ? <SheetSurface threadKey={sceneryKey}>{list}</SheetSurface> : list;
}

type ThreadSettingsPickerStackParams = {
  ThreadSettingsHome: undefined;
  ThreadSettingsModels: undefined;
};

type ThreadSettingsPickerPresentation = {
  readonly onClose: () => void;
};

const ThreadSettingsPickerStack = createNativeStackNavigator<ThreadSettingsPickerStackParams>();
const ThreadSettingsPickerPresentationContext =
  createContext<ThreadSettingsPickerPresentation | null>(null);

function useThreadSettingsPickerPresentation() {
  const value = use(ThreadSettingsPickerPresentationContext);
  if (!value) {
    throw new Error(
      "useThreadSettingsPickerPresentation must be used inside ThreadSettingsPickerNavigator.",
    );
  }
  return value;
}

function ThreadSettingsHomeScreen() {
  const session = useThreadSettingsSession();
  const presentation = useThreadSettingsPickerPresentation();
  const navigation = useNavigation<NativeStackNavigationProp<ThreadSettingsPickerStackParams>>();
  const insets = useSafeAreaInsets();
  const sceneryKey = useThreadSettingsSceneryKey();
  const setSearchQuery = session.setSearchQuery;
  const openModels = useCallback(() => {
    setSearchQuery("");
    navigation.navigate("ThreadSettingsModels");
  }, [navigation, setSearchQuery]);
  const transfer = useProjectTransferAction(
    session.checkpointsThreadRef,
    (environmentId, threadId) => {
      const parent = navigation.getParent();
      presentation.onClose();
      parent?.dispatch(
        StackActions.replace("Thread", {
          environmentId: String(environmentId),
          threadId: String(threadId),
        }),
      );
    },
  );
  return (
    <>
      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          actions={[
            { accessibilityLabel: "Done", icon: "checkmark", onPress: presentation.onClose },
          ]}
          onBack={presentation.onClose}
          title="Model"
          hideBottomBorder
        />
      ) : null}
      <SheetSurface threadKey={sceneryKey}>
        <ScrollView
          automaticallyAdjustsScrollIndicatorInsets
          className="flex-1"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            paddingTop: 12,
            paddingBottom: Platform.OS === "ios" ? 24 : insets.bottom + 24,
          }}
          style={
            Platform.OS === "android"
              ? { width: "100%", maxWidth: 720, alignSelf: "center" }
              : undefined
          }
        >
          <ThreadSettingsOptions onPressModel={openModels} />
          <ThreadSettingsThreadSections
            projectTransfer={
              transfer.supported
                ? {
                    isPending: transfer.isPending,
                    pendingLabel: transfer.pendingLabel,
                    onPress: transfer.present,
                  }
                : undefined
            }
          />
        </ScrollView>
      </SheetSurface>
      <NativeHeaderToolbar placement="right">
        <NativeHeaderToolbar.Button
          accessibilityLabel="Done"
          label="Done"
          onPress={presentation.onClose}
        />
      </NativeHeaderToolbar>
    </>
  );
}

function ThreadSettingsModelsScreen() {
  const session = useThreadSettingsSession();
  const presentation = useThreadSettingsPickerPresentation();
  const navigation = useNavigation<NativeStackNavigationProp<ThreadSettingsPickerStackParams>>();
  const usesNativeMailSearchToolbar = useNativeMailSearchToolbar();
  const hasCustomCatalogFilter = session.showLegacy;
  const filterMenu = useMemo(
    () => ({
      title: "Model filters",
      items: session.hasLegacyModels
        ? [
            {
              type: "action" as const,
              title: "Show legacy models",
              state: session.showLegacy ? ("on" as const) : ("off" as const),
              onPress: () => session.setShowLegacy(!session.showLegacy),
            },
          ]
        : [],
    }),
    [session],
  );

  return (
    <>
      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          actions={[
            { accessibilityLabel: "Done", icon: "checkmark", onPress: presentation.onClose },
          ]}
          onBack={() => navigation.goBack()}
          title="Models"
          hideBottomBorder
        />
      ) : null}
      <NativeStackScreenOptions
        optionsVersion={[session.showLegacy]}
        options={{
          unstable_headerToolbarItems: usesNativeMailSearchToolbar
            ? () => [
                createNativeMailSearchToolbarItem({
                  filterButtonId: "thread-settings-model-filter",
                  filterMenu,
                  filterSystemImageName: hasCustomCatalogFilter
                    ? "line.3.horizontal.decrease.circle.fill"
                    : "line.3.horizontal.decrease",
                  onSearchTextChange: session.setSearchQuery,
                  placeholder: "Find a model",
                  searchTextChangeId: "thread-settings-model-search-text",
                  showsSearchDismissButton: true,
                }),
              ]
            : undefined,
          headerShown: Platform.OS !== "android",
          headerSearchBarOptions:
            Platform.OS === "ios" && !usesNativeMailSearchToolbar
              ? {
                  autoCapitalize: "none",
                  hideNavigationBar: false,
                  hideWhenScrolling: false,
                  obscureBackground: false,
                  onCancelButtonPress: () => session.setSearchQuery(""),
                  onChangeText: (event) => session.setSearchQuery(event.nativeEvent.text),
                  placeholder: "Find a model",
                }
              : undefined,
        }}
      />
      <ThreadSettingsCatalog />
      <NativeHeaderToolbar placement="right">
        <NativeHeaderToolbar.Button
          accessibilityLabel="Done"
          label="Done"
          onPress={presentation.onClose}
        />
      </NativeHeaderToolbar>
      {Platform.OS === "ios" && !usesNativeMailSearchToolbar && session.hasLegacyModels ? (
        <NativeHeaderToolbar placement="bottom">
          <NativeHeaderToolbar.Menu
            accessibilityLabel="Filter models"
            icon={
              hasCustomCatalogFilter
                ? "line.3.horizontal.decrease.circle.fill"
                : "line.3.horizontal.decrease.circle"
            }
            separateBackground
            title="Model filters"
          >
            <NativeHeaderToolbar.MenuAction
              isOn={session.showLegacy}
              onPress={() => session.setShowLegacy(!session.showLegacy)}
            >
              Show legacy models
            </NativeHeaderToolbar.MenuAction>
          </NativeHeaderToolbar.Menu>
        </NativeHeaderToolbar>
      ) : null}
    </>
  );
}

function ThreadSettingsPickerNavigator(props: ThreadSettingsPickerPresentation) {
  const theme = useUniwindTheme();
  const solidSheetBackground = theme["--color-sheet-solid"];
  const foreground = theme["--color-foreground"];
  // Over glass the page plates its own photo, so the stack and its bar stay
  // clear; iOS before 26 keeps the opaque bar like the main stack.
  const glass = useGlassChromeActive();
  const transparentHeader = glass && TRANSPARENT_NATIVE_HEADERS;
  const presentation = useMemo(() => ({ onClose: props.onClose }), [props.onClose]);

  return (
    <ThreadSettingsPickerPresentationContext.Provider value={presentation}>
      <ThreadSettingsPickerStack.Navigator
        screenOptions={{
          contentStyle: { backgroundColor: glass ? "transparent" : solidSheetBackground },
          headerShown: Platform.OS !== "android",
          headerShadowVisible: false,
          headerStyle: {
            backgroundColor:
              NATIVE_LIQUID_GLASS_SUPPORTED || transparentHeader
                ? "transparent"
                : solidSheetBackground,
          },
          headerTransparent: NATIVE_LIQUID_GLASS_SUPPORTED || transparentHeader,
          headerTintColor: foreground,
          headerTitleStyle: { fontSize: 17, fontWeight: "700" },
          scrollEdgeEffects:
            NATIVE_LIQUID_GLASS_SUPPORTED || transparentHeader
              ? THREAD_SETTINGS_HEADER_SCROLL_EDGE_EFFECTS
              : undefined,
        }}
      >
        <ThreadSettingsPickerStack.Screen
          name="ThreadSettingsHome"
          component={ThreadSettingsHomeScreen}
          options={{ headerBackVisible: false, title: "Model" }}
        />
        <ThreadSettingsPickerStack.Screen
          name="ThreadSettingsModels"
          component={ThreadSettingsModelsScreen}
          options={{ title: "Models" }}
        />
      </ThreadSettingsPickerStack.Navigator>
    </ThreadSettingsPickerPresentationContext.Provider>
  );
}

/** Shared model catalog and option screens, bound to the caller's draft. */
export function ThreadSettingsPickerScreen(
  props: ThreadSettingsSessionProps & { readonly onClose: () => void },
) {
  return (
    <ThreadSettingsSessionProvider {...props}>
      <ThreadSettingsPickerNavigator onClose={props.onClose} />
    </ThreadSettingsSessionProvider>
  );
}

/** Existing-thread model picker hosted by the root RNS form-sheet route. */
export function ExistingThreadSettingsRouteScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const presentation = useExistingThreadSettingsRoutePresentation();
  const session = presentation.session;

  useEffect(() => {
    if (session) {
      return;
    }

    navigation.goBack();
  }, [navigation, session]);

  if (!session) {
    return <SheetSurface />;
  }

  const { ownerId: _ownerId, ...settings } = session;

  return (
    <ThreadSettingsSessionProvider {...settings}>
      <ThreadSettingsPickerNavigator onClose={() => navigation.goBack()} />
    </ThreadSettingsSessionProvider>
  );
}

/** New-task model picker hosted by the root RNS form-sheet route. */
export function NewTaskThreadSettingsRouteScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const flow = useNewTaskFlow();
  const settings = useMemo(
    () =>
      buildNewTaskThreadSettingsSession({
        environmentId: flow.selectedEnvironmentId,
        selectedModel: flow.selectedModel,
        selectedModelOption: flow.selectedModelOption,
        providerGroups: flow.providerGroups,
        runtimeMode: flow.runtimeMode,
      }),
    [
      flow.providerGroups,
      flow.runtimeMode,
      flow.selectedEnvironmentId,
      flow.selectedModel,
      flow.selectedModelOption,
    ],
  );
  const handleSelectModel = useCallback(
    (option: ModelOption) => {
      flow.setSelectedModelKey(option.key, option.selection.options);
    },
    [flow.setSelectedModelKey],
  );

  return (
    <ThreadSettingsSessionProvider
      environmentId={settings.environmentId}
      {...(settings.providerInstanceId ? { providerInstanceId: settings.providerInstanceId } : {})}
      providerGroups={settings.providerGroups}
      selectedModel={settings.selectedModel}
      onSelectModel={handleSelectModel}
      optionDescriptors={settings.optionDescriptors}
      onUpdateOptionSelections={flow.setSelectedModelOptions}
      runtimeMode={settings.runtimeMode}
      onUpdateRuntimeMode={flow.setRuntimeMode}
    >
      <ThreadSettingsPickerNavigator onClose={() => navigation.goBack()} />
    </ThreadSettingsSessionProvider>
  );
}
