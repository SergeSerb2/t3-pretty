import type {
  ModelSelection,
  ProviderInteractionMode,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  RuntimeMode,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { displayRuntimeModeForProviderDriver } from "@t3tools/contracts";
import type { LegendListRenderItemProps } from "@legendapp/list/react-native";
import { AnimatedLegendList } from "@legendapp/list/reanimated";
import { HeaderHeightContext } from "@react-navigation/elements";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionCurrentValue,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";
import { CONNECT_BRANDING } from "@t3tools/shared/connectBranding";
import { StackActions, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import {
  createNativeStackNavigator,
  type NativeStackNavigationProp,
} from "@react-navigation/native-stack";
import * as Haptics from "expo-haptics";
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
import { Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { ProviderIcon } from "../../components/ProviderIcon";
import { ThemedSwitch } from "../../components/ThemedSwitch";
import { cn } from "../../lib/cn";
import { limitMobileSearchQuery, MOBILE_TEXT_SEARCH_QUERY_MAX_LENGTH } from "../../lib/searchQuery";
import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import { applyProviderOptionSelection } from "../../lib/providerOptions";
import { useThemeColor } from "../../lib/useThemeColor";
import {
  NativeHeaderToolbar,
  NativeStackScreenOptions,
  nativeHeaderScrollEdgeEffects,
} from "../../native/StackHeader";
import { NATIVE_LIQUID_GLASS_SUPPORTED } from "../../native/native-glass";
import {
  createNativeMailSearchToolbarItem,
  NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET,
  NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED,
} from "../layout/native-mail-search-toolbar";
import {
  runtimeModeChoicesForProvider,
  selectableChoices,
  selectedModelProviderDriver,
} from "./thread-settings-options";
import { buildThreadModelIdentity } from "./threadModelIdentity";
import { ThreadCheckpointsSection } from "./ThreadCheckpointsSection";
import { useProjectTransferAction } from "./use-project-transfer";
import {
  effectiveProviderFilter,
  initialProviderFilter,
  modelMatchesCatalogQuery,
  pendingModelAfterPress,
  presentedSettingsSheetPage,
  providerSectionIsCollapsed,
  threadSettingsSheetPageForRoute,
  visibleSheetOptionDescriptors,
  type ThreadSettingsSheetPage,
} from "./thread-settings-sheet-state";

export type { ThreadSettingsSheetPage };

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
const THREAD_SETTINGS_OPTIONS_LAYOUT_TRANSITION = LinearTransition.duration(180);
const THREAD_SETTINGS_OPTION_ENTER_TRANSITION = FadeIn.duration(140);
const THREAD_SETTINGS_OPTION_EXIT_TRANSITION = FadeOut.duration(100);
const THREAD_SETTINGS_HEADER_SCROLL_EDGE_EFFECTS = nativeHeaderScrollEdgeEffects(
  Platform.OS,
  Platform.Version,
);

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
  const runtime = runtimeModeChoicesForProvider(input.providerDriver).find(
    (choice) =>
      choice.mode === displayRuntimeModeForProviderDriver(input.providerDriver, input.runtimeMode),
  );
  return [
    identity.summary,
    ...(runtime ? [runtime.shortLabel] : []),
    ...(input.interactionMode === "plan" ? ["Plan"] : []),
  ].join(" · ");
}

function ModelRow(props: {
  readonly option: ModelOption;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}) {
  const checkmarkColor = useThemeColor("--color-icon");
  return (
    <Pressable
      accessibilityLabel={props.option.label}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      onPress={props.onPress}
      className={cn(
        "mx-4 min-h-11 flex-row items-center gap-2 bg-card px-4 py-2 active:bg-subtle",
        props.isFirst && "rounded-t-2xl",
        props.isLast ? "rounded-b-2xl" : "border-b border-border-subtle",
      )}
    >
      <Text className="min-w-0 shrink text-base font-t3-medium text-foreground" numberOfLines={1}>
        {props.option.label}
      </Text>
      {props.option.isDefault ? (
        <View className="rounded-md bg-subtle-strong px-1.5 py-0.5">
          <Text className="text-3xs font-t3-bold text-foreground-muted">Default</Text>
        </View>
      ) : null}
      {props.option.isLegacy ? (
        <View className="rounded-md bg-subtle px-1.5 py-0.5">
          <Text className="text-3xs font-t3-bold text-foreground-muted">Legacy</Text>
        </View>
      ) : null}
      <View className="flex-1" />
      {props.selected ? (
        <SymbolView
          name="checkmark"
          size={16}
          tintColor={checkmarkColor}
          type="monochrome"
          weight="semibold"
        />
      ) : null}
    </Pressable>
  );
}

/** Provider catalog header with its harness logo and disclosure state. */
function ProviderHeader(props: {
  readonly driver: string | undefined;
  readonly label: string;
  readonly collapsible: boolean;
  readonly collapsed: boolean;
  readonly modelCount: number;
  readonly onToggle: () => void;
}) {
  const iconSubtle = useThemeColor("--color-icon-subtle");
  const content = (
    <>
      <ProviderIcon provider={props.driver} size={15} />
      <Text className="text-sm font-t3-medium text-foreground-muted">{props.label}</Text>
      {props.collapsible ? (
        <>
          <View className="flex-1" />
          {props.collapsed ? (
            <Text className="text-2xs font-t3-medium text-foreground-muted">
              {props.modelCount}
            </Text>
          ) : null}
          <SymbolView
            name={props.collapsed ? "chevron.down" : "chevron.up"}
            size={12}
            tintColor={iconSubtle}
            type="monochrome"
          />
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
        className="mx-4 mt-1 min-h-11 flex-row items-center gap-2 rounded-xl px-1 pt-2 active:opacity-60"
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
  const iconSubtle = useThemeColor("--color-icon-subtle");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled === true }}
      disabled={props.disabled}
      onPress={props.onPress}
      className={cn(
        "min-h-11 flex-row items-center gap-2 px-5 py-2.5 active:opacity-70",
        props.disabled && "opacity-55",
      )}
    >
      <Text className="text-sm font-t3-medium text-foreground">{props.label}</Text>
      <View className="flex-1" />
      {props.value ? (
        <Text className="text-sm text-foreground-muted" numberOfLines={1}>
          {props.value}
        </Text>
      ) : null}
      <SymbolView name="chevron.right" size={12} tintColor={iconSubtle} type="monochrome" />
    </Pressable>
  );
}

/** Single option inside a submenu panel. */
function ChoiceRow(props: {
  readonly label: string;
  readonly description?: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly isLast: boolean;
}) {
  const checkmarkColor = useThemeColor("--color-icon");
  return (
    <Pressable
      accessibilityLabel={props.description ? `${props.label}. ${props.description}` : props.label}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      onPress={props.onPress}
      className={cn(
        "min-h-14 flex-row items-center gap-3 bg-card px-4 py-3 active:bg-subtle",
        !props.isLast && "border-b border-border-subtle",
      )}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-base font-t3-medium text-foreground">{props.label}</Text>
        {props.description ? (
          <Text className="text-sm leading-5 text-foreground-muted">{props.description}</Text>
        ) : null}
      </View>
      {props.selected ? (
        <SymbolView
          name="checkmark"
          size={16}
          tintColor={checkmarkColor}
          type="monochrome"
          weight="semibold"
        />
      ) : null}
    </Pressable>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected }}
      className={cn(
        "h-8 justify-center rounded-full px-3",
        props.selected ? "bg-primary" : "bg-card",
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

type ThreadSettingsSubmenuPage =
  | { readonly kind: "descriptor"; readonly id: string }
  | { readonly kind: "runtime" };

type ThreadSettingsSessionProps = {
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly selectedModel: ModelSelection | null;
  readonly onSelectModel: (option: ModelOption) => void;
  readonly optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly onUpdateOptionSelections: (selections: ReadonlyArray<ProviderOptionSelection>) => void;
  readonly runtimeMode: RuntimeMode;
  readonly onUpdateRuntimeMode: (mode: RuntimeMode) => void;
  readonly initialPage?: ThreadSettingsSheetPage;
  /** Existing-thread sessions only: enables the Checkpoints card with its
      per-checkpoint revert action. Absent in the new-task flow. */
  readonly checkpointsThreadRef?: ScopedThreadRef | null;
};

export type ExistingThreadSettingsRouteSession = ThreadSettingsSessionProps & {
  readonly ownerId: string;
};

type PresentExistingThreadSettingsOptions = {
  readonly preservePage?: boolean;
};

type ExistingThreadSettingsRouteContextValue = {
  readonly session: ExistingThreadSettingsRouteSession | null;
  readonly present: (
    session: ExistingThreadSettingsRouteSession,
    options?: PresentExistingThreadSettingsOptions,
  ) => void;
  readonly setPage: (page: ThreadSettingsSheetPage) => void;
  readonly clear: (ownerId: string) => void;
};

const ExistingThreadSettingsRouteContext =
  createContext<ExistingThreadSettingsRouteContextValue | null>(null);

/** Bridges the active thread's settings state into the root native sheet route. */
export function ExistingThreadSettingsRouteProvider(props: { readonly children: ReactNode }) {
  const [session, setSession] = useState<ExistingThreadSettingsRouteSession | null>(null);
  const present = useCallback(
    (
      nextSession: ExistingThreadSettingsRouteSession,
      options?: PresentExistingThreadSettingsOptions,
    ) => {
      setSession((current) => ({
        ...nextSession,
        initialPage: presentedSettingsSheetPage({
          preservePage: options?.preservePage === true,
          currentOwnerId: current?.ownerId,
          nextOwnerId: nextSession.ownerId,
          currentPage: current?.initialPage,
          requestedPage: nextSession.initialPage,
        }),
      }));
    },
    [],
  );
  const setPage = useCallback((page: ThreadSettingsSheetPage) => {
    setSession((current) =>
      current && current.initialPage !== page ? { ...current, initialPage: page } : current,
    );
  }, []);
  const clear = useCallback((ownerId: string) => {
    setSession((current) => (current?.ownerId === ownerId ? null : current));
  }, []);
  const value = useMemo(
    () => ({ session, present, setPage, clear }),
    [clear, present, session, setPage],
  );

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
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly runtimeMode: RuntimeMode;
  readonly onUpdateRuntimeMode: (mode: RuntimeMode) => void;
  readonly runtimeModeChoices: ReturnType<typeof runtimeModeChoicesForProvider>;
  readonly displayedDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly displayedModel: ModelOption | null;
  readonly providerExpansionOverrides: ReadonlySet<string>;
  readonly hasLegacyModels: boolean;
  readonly initialPage: ThreadSettingsSheetPage;
  readonly checkpointsThreadRef: ScopedThreadRef | null;
  readonly pendingModel: ModelOption | null;
  readonly providerFilter: string | null;
  readonly searchQuery: string;
  readonly showLegacy: boolean;
  readonly applyOptionChange: (id: string, value: string | boolean) => void;
  readonly commitPendingModel: () => void;
  readonly isApplied: (option: ModelOption) => boolean;
  readonly isDisplayed: (option: ModelOption) => boolean;
  readonly pressModel: (option: ModelOption) => void;
  readonly setProviderFilter: (providerKey: string | null) => void;
  readonly setSearchQuery: (query: string) => void;
  readonly setShowLegacy: (showLegacy: boolean) => void;
  readonly toggleProvider: (providerKey: string) => void;
};

const ThreadSettingsSessionContext = createContext<ThreadSettingsSessionValue | null>(null);

/** Owns the staged model and option state for one picker presentation. */
function ThreadSettingsSessionProvider(
  props: ThreadSettingsSessionProps & { readonly children: ReactNode },
) {
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
  const [pendingModel, setPendingModel] = useState<ModelOption | null>(null);

  const isApplied = useCallback(
    (option: ModelOption) =>
      option.selection.instanceId === props.selectedModel?.instanceId &&
      option.selection.model === props.selectedModel.model,
    [props.selectedModel],
  );
  // The list highlights the staged pick; Save turns it into the applied one.
  const isDisplayed = useCallback(
    (option: ModelOption) => (pendingModel ? option.key === pendingModel.key : isApplied(option)),
    [isApplied, pendingModel],
  );

  // While a model is staged, the settings rows describe and edit the staged
  // model's options (kept on its pending selection); Save applies model and
  // options together. Otherwise they edit the applied selection directly.
  const displayedDescriptors = useMemo(
    () =>
      pendingModel
        ? pendingModel.capabilities
          ? getProviderOptionDescriptors({
              caps: pendingModel.capabilities,
              selections: pendingModel.selection.options,
            })
          : []
        : props.optionDescriptors,
    [pendingModel, props.optionDescriptors],
  );
  const visibleDescriptors = useMemo(
    () => visibleSheetOptionDescriptors(displayedDescriptors),
    [displayedDescriptors],
  );
  // Runtime modes follow the same staged model as the option rows above, so
  // a staged Kimi pick already shows Kimi's Auto/Yolo naming before Save.
  const runtimeModeChoices = useMemo(
    () =>
      runtimeModeChoicesForProvider(
        pendingModel?.providerDriver ??
          selectedModelProviderDriver({
            providerGroups: props.providerGroups,
            selectedModel: props.selectedModel,
          }),
      ),
    [pendingModel?.providerDriver, props.providerGroups, props.selectedModel],
  );

  const hasLegacyModels = useMemo(
    () => props.providerGroups.some((group) => group.models.some((model) => model.isLegacy)),
    [props.providerGroups],
  );
  const displayedModel = useMemo(() => {
    if (pendingModel) {
      return pendingModel;
    }
    for (const group of props.providerGroups) {
      const applied = group.models.find(isApplied);
      if (applied) {
        return applied;
      }
    }
    return null;
  }, [isApplied, pendingModel, props.providerGroups]);
  const commitPendingModel = useCallback(() => {
    if (pendingModel) {
      void Haptics.selectionAsync();
      props.onSelectModel(pendingModel);
    }
  }, [pendingModel, props.onSelectModel]);

  const applyOptionChange = useCallback(
    (id: string, value: string | boolean) => {
      const next = applyProviderOptionSelection(displayedDescriptors, { id, value });
      if (!next) {
        return;
      }
      if (pendingModel) {
        setPendingModel({
          ...pendingModel,
          selection: { ...pendingModel.selection, options: next },
        });
      } else {
        props.onUpdateOptionSelections(next);
      }
    },
    [displayedDescriptors, pendingModel, props.onUpdateOptionSelections],
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

  const pressModel = useCallback(
    (option: ModelOption) => {
      void Haptics.selectionAsync();
      setPendingModel((current) =>
        pendingModelAfterPress({
          current,
          pressed: option,
          pressedIsApplied: isApplied(option),
        }),
      );
    },
    [isApplied],
  );

  const value = useMemo<ThreadSettingsSessionValue>(
    () => ({
      providerGroups: props.providerGroups,
      runtimeMode: props.runtimeMode,
      onUpdateRuntimeMode: props.onUpdateRuntimeMode,
      runtimeModeChoices,
      displayedDescriptors: visibleDescriptors,
      displayedModel,
      providerExpansionOverrides,
      hasLegacyModels,
      initialPage: props.initialPage ?? "home",
      checkpointsThreadRef: props.checkpointsThreadRef ?? null,
      pendingModel,
      providerFilter,
      searchQuery,
      showLegacy: showLegacyToggle,
      applyOptionChange,
      commitPendingModel,
      isApplied,
      isDisplayed,
      pressModel,
      setProviderFilter,
      setSearchQuery,
      setShowLegacy: setShowLegacyToggle,
      toggleProvider,
    }),
    [
      applyOptionChange,
      commitPendingModel,
      visibleDescriptors,
      displayedModel,
      providerExpansionOverrides,
      hasLegacyModels,
      props.initialPage,
      props.checkpointsThreadRef,
      isApplied,
      isDisplayed,
      pendingModel,
      pressModel,
      providerFilter,
      props.onUpdateRuntimeMode,
      props.providerGroups,
      props.runtimeMode,
      runtimeModeChoices,
      searchQuery,
      showLegacyToggle,
      toggleProvider,
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

type ThreadSettingsProviderCatalog = {
  readonly key: string;
  readonly driver: string | undefined;
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
      readonly kind: "empty";
      readonly key: "empty";
    };

function ThreadSettingsModelListRow(props: {
  readonly option: ModelOption;
  readonly isFirst: boolean;
  readonly isLast: boolean;
}) {
  const session = useThreadSettingsSession();
  const onPress = useCallback(
    () => session.pressModel(props.option),
    [props.option, session.pressModel],
  );

  return (
    <ModelRow
      isFirst={props.isFirst}
      isLast={props.isLast}
      onPress={onPress}
      option={props.option}
      selected={session.isDisplayed(props.option)}
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
      collapsible={props.provider.collapsible}
      collapsed={props.provider.collapsed}
      driver={props.provider.driver}
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
        const driver = group.models[0]?.providerDriver;
        const catalogModels = session.showLegacy
          ? group.models
          : group.models.filter((model) => !model.isLegacy || session.isDisplayed(model));
        const visibleModels = catalogModels.filter((model) =>
          modelMatchesCatalogQuery({
            model,
            providerLabel: group.providerLabel,
            query: session.searchQuery,
          }),
        );
        if (visibleModels.length === 0) {
          return [];
        }
        const containsDisplayedSelection = group.models.some(session.isDisplayed);
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
        ];
      }),
    [
      session.isApplied,
      session.isDisplayed,
      session.providerExpansionOverrides,
      session.providerFilter,
      session.providerGroups,
      session.searchQuery,
      session.showLegacy,
    ],
  );
}

function ThreadSettingsOptionsCard(props: {
  readonly onOpenSubmenu: (submenu: ThreadSettingsSubmenuPage) => void;
}) {
  const session = useThreadSettingsSession();

  return (
    <Animated.View
      className="mx-4 overflow-hidden rounded-2xl bg-card"
      layout={THREAD_SETTINGS_OPTIONS_LAYOUT_TRANSITION}
    >
      {session.displayedDescriptors.map((descriptor) => {
        if (descriptor.type === "select") {
          return (
            <Animated.View
              key={descriptor.id}
              layout={THREAD_SETTINGS_OPTIONS_LAYOUT_TRANSITION}
              entering={THREAD_SETTINGS_OPTION_ENTER_TRANSITION}
              exiting={THREAD_SETTINGS_OPTION_EXIT_TRANSITION}
            >
              <DisclosureRow
                label={descriptor.label}
                value={getProviderOptionCurrentLabel(descriptor)}
                onPress={() => props.onOpenSubmenu({ kind: "descriptor", id: descriptor.id })}
              />
            </Animated.View>
          );
        }
        return (
          <Animated.View
            key={descriptor.id}
            layout={THREAD_SETTINGS_OPTIONS_LAYOUT_TRANSITION}
            entering={THREAD_SETTINGS_OPTION_ENTER_TRANSITION}
            exiting={THREAD_SETTINGS_OPTION_EXIT_TRANSITION}
          >
            <SwitchRow
              label={descriptor.label}
              value={descriptor.currentValue ?? false}
              onValueChange={(value) => session.applyOptionChange(descriptor.id, value)}
            />
          </Animated.View>
        );
      })}
      <Animated.View layout={THREAD_SETTINGS_OPTIONS_LAYOUT_TRANSITION}>
        <DisclosureRow
          isLast
          label="Runtime"
          value={
            session.runtimeModeChoices.find((choice) => choice.mode === session.runtimeMode)?.label
          }
          onPress={() => props.onOpenSubmenu({ kind: "runtime" })}
        />
      </Animated.View>
    </Animated.View>
  );
}

function ThreadSettingsHomeContent(props: {
  readonly onOpenCatalog: () => void;
  readonly onOpenSubmenu: (submenu: ThreadSettingsSubmenuPage) => void;
  readonly projectTransfer?: {
    readonly isPending: boolean;
    readonly onPress: () => void;
  };
}) {
  const insets = useSafeAreaInsets();
  const session = useThreadSettingsSession();
  const iconSubtle = useThemeColor("--color-icon-subtle");
  const model = session.displayedModel;

  return (
    <ScrollView
      className="flex-1 bg-sheet"
      contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingTop: 8 }}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      <Text className="px-5 pb-2 pt-2 text-sm font-t3-medium text-foreground-muted">Model</Text>
      <Pressable
        accessibilityHint="Opens the model catalog"
        accessibilityLabel={model ? `Change model, ${model.label}` : "Choose model"}
        accessibilityRole="button"
        className="mx-4 min-h-14 flex-row items-center gap-3 rounded-2xl bg-card px-4 py-3 active:opacity-70"
        onPress={props.onOpenCatalog}
      >
        <ProviderIcon provider={model?.providerDriver} size={18} />
        <View className="min-w-0 flex-1">
          <Text className="text-base font-t3-medium text-foreground" numberOfLines={1}>
            {model?.label ?? "Choose model"}
          </Text>
          {model?.providerLabel ? (
            <Text className="text-sm text-foreground-muted" numberOfLines={1}>
              {model.providerLabel}
            </Text>
          ) : null}
        </View>
        <Text className="text-sm font-t3-medium text-foreground-muted">Change</Text>
        <SymbolView name="chevron.right" size={12} tintColor={iconSubtle} type="monochrome" />
      </Pressable>

      <Text className="px-5 pb-2 pt-7 text-sm font-t3-medium text-foreground-muted">Options</Text>
      <ThreadSettingsOptionsCard onOpenSubmenu={props.onOpenSubmenu} />

      {props.projectTransfer ? (
        <>
          <Text className="px-5 pb-2 pt-7 text-sm font-t3-medium text-foreground-muted">
            Project
          </Text>
          <View className="mx-4 overflow-hidden rounded-2xl bg-card">
            <DisclosureRow
              disabled={props.projectTransfer.isPending}
              label={props.projectTransfer.isPending ? "Moving thread…" : "Move to connection"}
              value={CONNECT_BRANDING.connectName}
              onPress={props.projectTransfer.onPress}
            />
          </View>
          <Text className="px-5 pt-2 text-xs leading-4 text-foreground-muted">
            Copies this conversation and project files. The source stays unchanged.
          </Text>
        </>
      ) : null}

      {session.checkpointsThreadRef !== null ? (
        <ThreadCheckpointsSection threadRef={session.checkpointsThreadRef} />
      ) : null}
    </ScrollView>
  );
}

function ThreadSettingsCatalogContent() {
  const session = useThreadSettingsSession();
  const catalogItems = useThreadSettingsCatalogItems(session);
  const [animationsReady, setAnimationsReady] = useState(false);
  const nativeHeaderHeight = use(HeaderHeightContext) ?? 0;
  const insets = useSafeAreaInsets();
  const hasActiveCatalogFilter =
    session.providerFilter !== null || session.searchQuery.trim().length > 0;
  const usesTransparentNativeHeader = Platform.OS === "ios" && NATIVE_LIQUID_GLASS_SUPPORTED;
  const bottomToolbarInset =
    Platform.OS === "ios" && NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED
      ? NATIVE_MAIL_SEARCH_TOOLBAR_CONTENT_INSET
      : 0;
  const listItems = useMemo<ReadonlyArray<ThreadSettingsCatalogItem>>(
    () =>
      catalogItems.length === 0 && hasActiveCatalogFilter
        ? ([{ kind: "empty", key: "empty" }] as const)
        : catalogItems,
    [catalogItems, hasActiveCatalogFilter],
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
      } else {
        content = (
          <View className="items-center px-8 py-14">
            <Text className="text-center text-sm text-foreground-muted">No matching models</Text>
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
    [animationsReady],
  );

  return (
    <AnimatedLegendList
      automaticallyAdjustsScrollIndicatorInsets
      className="flex-1 bg-sheet"
      contentContainerStyle={{
        paddingBottom: insets.bottom + bottomToolbarInset + 12,
        paddingTop: 4,
      }}
      contentInsetAdjustmentBehavior={usesTransparentNativeHeader ? "never" : "automatic"}
      data={listItems}
      estimatedItemSize={48}
      extraData={animationsReady}
      getItemType={(item) => item.kind}
      itemLayoutAnimation={THREAD_SETTINGS_CATALOG_LAYOUT_TRANSITION}
      keyExtractor={(item) => item.key}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      maintainVisibleContentPosition={THREAD_SETTINGS_MAINTAIN_VISIBLE_CONTENT_POSITION}
      ListHeaderComponent={
        <>
          {usesTransparentNativeHeader ? <View style={{ height: nativeHeaderHeight }} /> : null}
          {Platform.OS === "android" ? (
            <View className="px-4 pb-2 pt-3">
              <TextInput
                accessibilityLabel="Find a model"
                autoCapitalize="none"
                autoCorrect={false}
                className="h-11 rounded-xl bg-card px-4 text-base text-foreground"
                onChangeText={session.setSearchQuery}
                placeholder="Find a model"
                placeholderTextColorClassName="accent-placeholder"
                value={session.searchQuery}
              />
            </View>
          ) : null}
          {session.providerGroups.length > 1 ? (
            <ScrollView
              horizontal
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
              {session.providerGroups.map((group) => (
                <FilterChip
                  key={group.providerKey}
                  label={group.providerLabel}
                  selected={session.providerFilter === group.providerKey}
                  onPress={() => session.setProviderFilter(group.providerKey)}
                />
              ))}
            </ScrollView>
          ) : null}
        </>
      }
      ListFooterComponent={
        Platform.OS !== "ios" && session.hasLegacyModels ? (
          <View className="mt-6">
            <Text className="px-5 pb-2 text-sm font-t3-medium text-foreground-muted">Catalog</Text>
            <View className="mx-4 overflow-hidden rounded-2xl bg-card">
              <SwitchRow
                isLast
                label="Legacy models"
                onValueChange={session.setShowLegacy}
                value={session.showLegacy}
              />
            </View>
          </View>
        ) : null
      }
      recycleItems
      onLoad={() => setAnimationsReady(true)}
      renderItem={renderCatalogItem}
      showsVerticalScrollIndicator={false}
    />
  );
}

/** Compact choice page pushed by the picker navigator. */
function ThreadSettingsChoiceContent(props: {
  readonly submenu: ThreadSettingsSubmenuPage;
  readonly onSelected: () => void;
}) {
  const insets = useSafeAreaInsets();
  const session = useThreadSettingsSession();
  const descriptorId = props.submenu.kind === "descriptor" ? props.submenu.id : null;

  const activeDescriptor =
    descriptorId !== null
      ? session.displayedDescriptors.find(
          (descriptor) => descriptor.type === "select" && descriptor.id === descriptorId,
        )
      : undefined;

  const submenuContent =
    props.submenu.kind === "runtime"
      ? {
          rows: session.runtimeModeChoices.map((choice) => ({
            id: choice.mode,
            label: choice.label,
            description: choice.description,
            selected: choice.mode === session.runtimeMode,
            onPress: () => {
              void Haptics.selectionAsync();
              session.onUpdateRuntimeMode(choice.mode);
              props.onSelected();
            },
          })),
        }
      : activeDescriptor?.type === "select"
        ? {
            rows: selectableChoices(activeDescriptor).map((choice) => ({
              id: choice.id,
              label: choice.label,
              description: undefined,
              selected: choice.id === getProviderOptionCurrentValue(activeDescriptor),
              onPress: () => {
                void Haptics.selectionAsync();
                session.applyOptionChange(activeDescriptor.id, choice.id);
                props.onSelected();
              },
            })),
          }
        : null;

  if (!submenuContent) {
    return <View className="flex-1 bg-sheet" />;
  }

  return (
    <ScrollView
      className="flex-1 bg-sheet"
      contentContainerStyle={{
        paddingBottom: insets.bottom + 12,
        paddingHorizontal: 16,
        paddingTop: 16,
      }}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
    >
      <View className="overflow-hidden rounded-2xl bg-card">
        {submenuContent.rows.map((row, index) => (
          <ChoiceRow
            key={row.id}
            description={row.description}
            isLast={index === submenuContent.rows.length - 1}
            label={row.label}
            selected={row.selected}
            onPress={row.onPress}
          />
        ))}
      </View>
    </ScrollView>
  );
}

type ThreadSettingsPickerStackParams = {
  ThreadSettingsHome: undefined;
  ThreadSettingsCatalog: undefined;
  ThreadSettingsChoice: ThreadSettingsSubmenuPage & { readonly title: string };
};

type ThreadSettingsPickerPresentation = {
  readonly onClose: () => void;
};

type ThreadSettingsPickerNavigatorProps = ThreadSettingsPickerPresentation & {
  readonly onActivePageChange: (page: ThreadSettingsSheetPage) => void;
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

function useCommitThreadSettings() {
  const session = useThreadSettingsSession();
  const presentation = useThreadSettingsPickerPresentation();
  return useCallback(() => {
    session.commitPendingModel();
    presentation.onClose();
  }, [presentation, session]);
}

function openThreadSettingsSubmenu(
  navigation: NativeStackNavigationProp<ThreadSettingsPickerStackParams>,
  session: ThreadSettingsSessionValue,
  submenu: ThreadSettingsSubmenuPage,
) {
  const title =
    submenu.kind === "runtime"
      ? "Runtime"
      : (session.displayedDescriptors.find(
          (descriptor) => descriptor.type === "select" && descriptor.id === submenu.id,
        )?.label ?? "Option");
  navigation.navigate("ThreadSettingsChoice", { ...submenu, title });
}

function ThreadSettingsHomeScreen() {
  const session = useThreadSettingsSession();
  const presentation = useThreadSettingsPickerPresentation();
  const navigation = useNavigation<NativeStackNavigationProp<ThreadSettingsPickerStackParams>>();
  const commitAndClose = useCommitThreadSettings();
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

  useLayoutEffect(() => {
    if (session.initialPage !== "catalog") {
      return;
    }
    const state = navigation.getState();
    const currentName = state.routes[state.index]?.name;
    if (currentName === "ThreadSettingsCatalog" || currentName === "ThreadSettingsChoice") {
      return;
    }
    navigation.navigate("ThreadSettingsCatalog");
  }, [navigation, session.initialPage]);

  return (
    <>
      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          actions={[
            {
              accessibilityLabel: session.pendingModel ? "Save thread settings" : "Done",
              icon: "checkmark",
              onPress: commitAndClose,
            },
          ]}
          onBack={presentation.onClose}
          title="Thread settings"
        />
      ) : null}
      <NativeStackScreenOptions options={{ headerShown: Platform.OS !== "android" }} />
      <ThreadSettingsHomeContent
        onOpenCatalog={() => navigation.navigate("ThreadSettingsCatalog")}
        onOpenSubmenu={(submenu) => openThreadSettingsSubmenu(navigation, session, submenu)}
        projectTransfer={
          transfer.supported
            ? { isPending: transfer.isPending, onPress: transfer.present }
            : undefined
        }
      />
      <NativeHeaderToolbar placement="left">
        <NativeHeaderToolbar.Button
          accessibilityLabel="Cancel thread settings"
          label="Cancel"
          onPress={presentation.onClose}
        />
      </NativeHeaderToolbar>
      <NativeHeaderToolbar placement="right">
        <NativeHeaderToolbar.Button
          accessibilityLabel={session.pendingModel ? "Save thread settings" : "Done"}
          label={session.pendingModel ? "Save" : "Done"}
          onPress={commitAndClose}
        />
      </NativeHeaderToolbar>
    </>
  );
}

function ThreadSettingsCatalogScreen() {
  const session = useThreadSettingsSession();
  const navigation = useNavigation<NativeStackNavigationProp<ThreadSettingsPickerStackParams>>();
  const usesNativeMailSearchToolbar = Platform.OS === "ios" && NATIVE_MAIL_SEARCH_TOOLBAR_SUPPORTED;
  const hasCustomCatalogFilter = session.showLegacy;
  const commitAndClose = useCommitThreadSettings();
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
            {
              accessibilityLabel: session.pendingModel ? "Save thread settings" : "Done",
              icon: "checkmark",
              onPress: commitAndClose,
            },
          ]}
          onBack={() => navigation.navigate("ThreadSettingsHome")}
          title="Model"
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
                  obscureBackground: false,
                  onCancelButtonPress: () => session.setSearchQuery(""),
                  onChangeText: (event) => session.setSearchQuery(event.nativeEvent.text),
                  placeholder: "Find a model",
                }
              : undefined,
        }}
      />
      <ThreadSettingsCatalogContent />
      <NativeHeaderToolbar placement="right">
        <NativeHeaderToolbar.Button
          accessibilityLabel={session.pendingModel ? "Save thread settings" : "Done"}
          label={session.pendingModel ? "Save" : "Done"}
          onPress={commitAndClose}
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

function ThreadSettingsChoiceScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ThreadSettingsPickerStackParams>>();
  const route = useRoute<RouteProp<ThreadSettingsPickerStackParams, "ThreadSettingsChoice">>();

  return (
    <>
      <NativeStackScreenOptions options={{ headerShown: Platform.OS !== "android" }} />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader title={route.params.title} onBack={() => navigation.goBack()} />
      ) : null}
      <ThreadSettingsChoiceContent submenu={route.params} onSelected={() => navigation.goBack()} />
    </>
  );
}

function ThreadSettingsPickerNavigator(props: ThreadSettingsPickerNavigatorProps) {
  const solidSheetBackground = String(useThemeColor("--color-sheet-solid"));
  const foreground = String(useThemeColor("--color-foreground"));
  const presentation = useMemo(
    () => ({
      onClose: props.onClose,
    }),
    [props.onClose],
  );
  // Nested stack hydrates at home. Skip that event so a remount cannot
  // overwrite a persisted catalog page before Home restores it.
  const skipHydrateRef = useRef(true);
  const onActivePageChange = props.onActivePageChange;

  return (
    <ThreadSettingsPickerPresentationContext.Provider value={presentation}>
      <ThreadSettingsPickerStack.Navigator
        initialRouteName="ThreadSettingsHome"
        screenListeners={{
          state: (event) => {
            const state = event.data.state;
            const routeName = state.routes[state.index]?.name;
            if (!routeName) {
              return;
            }
            if (skipHydrateRef.current) {
              skipHydrateRef.current = false;
              // Hydrate always lands on home. Don't let that overwrite a
              // persisted catalog page before Home's restore effect runs.
              if (routeName === "ThreadSettingsHome") {
                return;
              }
            }
            const page = threadSettingsSheetPageForRoute(routeName);
            if (page) {
              onActivePageChange(page);
            }
          },
        }}
        screenOptions={{
          animation: "slide_from_right",
          contentStyle: { backgroundColor: solidSheetBackground },
          gestureEnabled: true,
          headerBackButtonDisplayMode: "minimal",
          headerBackTitle: "",
          headerShadowVisible: false,
          headerStyle: {
            backgroundColor: NATIVE_LIQUID_GLASS_SUPPORTED ? "transparent" : solidSheetBackground,
          },
          headerTransparent: NATIVE_LIQUID_GLASS_SUPPORTED,
          headerTintColor: foreground,
          headerTitleStyle: { fontSize: 17, fontWeight: "700" },
          scrollEdgeEffects: NATIVE_LIQUID_GLASS_SUPPORTED
            ? THREAD_SETTINGS_HEADER_SCROLL_EDGE_EFFECTS
            : undefined,
        }}
      >
        <ThreadSettingsPickerStack.Screen
          name="ThreadSettingsHome"
          component={ThreadSettingsHomeScreen}
          options={{ headerBackVisible: false, title: "Thread settings" }}
        />
        <ThreadSettingsPickerStack.Screen
          name="ThreadSettingsCatalog"
          component={ThreadSettingsCatalogScreen}
          options={{ title: "Model" }}
        />
        <ThreadSettingsPickerStack.Screen
          name="ThreadSettingsChoice"
          component={ThreadSettingsChoiceScreen}
          options={({ route }) => ({ title: route.params.title })}
        />
      </ThreadSettingsPickerStack.Navigator>
    </ThreadSettingsPickerPresentationContext.Provider>
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
    return <View className="flex-1 bg-sheet" />;
  }

  const { ownerId: _ownerId, ...settings } = session;

  return (
    <ThreadSettingsSessionProvider {...settings} initialPage={session.initialPage}>
      <ThreadSettingsPickerNavigator
        onActivePageChange={presentation.setPage}
        onClose={() => navigation.goBack()}
      />
    </ThreadSettingsSessionProvider>
  );
}
