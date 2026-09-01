
import { cn } from "../../lib/utils";
import { PHOTO_SETS, type PhotoSetId } from "../../scenery/photoSets";
import { usePhotoSetStore } from "../../scenery/photoSetStore";
import { isBoringChatTheme } from "../../scenery/productTheme";
import { WORLD_SCENERY_THEME, WORLD_SCENERY_THEME_ID } from "../../scenery/worldSceneryTheme";
import {

  T3_CHAT_THEME,
  T3_CHAT_THEME_ID,
  type ThemeColors,
  type ThemeDefinition,
  type ThemePreference,
} from "../../themePalette";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { searchableSetting } from "./settingsSearch";
import { getThemeCardDefinition, previewColorsOf, type ThemeMode } from "./ThemePreviewCircles";
import { ThemeWireframe } from "./ThemeWireframe";

const PHOTO_SET_PREVIEW: Record<
  PhotoSetId,
  { readonly dark: Partial<ThemeColors>; readonly light: Partial<ThemeColors> }
> = {
  "world-scenery": { dark: {}, light: {} },
  "night-cities": {
    dark: {
      canvas: "#0a0e1a",
      accent: "#7aa2ff",
      accentSurface: "#243056",
      messageSurface: "#1b2744",
    },
    light: {
      canvas: "#eef1f8",
      accent: "#2a4a9a",
      accentSurface: "#d9e3f7",
      messageSurface: "#d4def0",
    },
  },
  "deep-forest": {
    dark: {
      canvas: "#0b140e",
      accent: "#8fce7a",
      accentSurface: "#2a4a32",
      messageSurface: "#1e3826",
    },
    light: {
      canvas: "#eef4ee",
      accent: "#2f6a3a",
      accentSurface: "#d7ead8",
      messageSurface: "#d3e6d4",
    },
  },
  "night-sky": {
    dark: {
      canvas: "#0b0a16",
      accent: "#9b8cff",
      accentSurface: "#2e2858",
      messageSurface: "#221e40",
    },
    light: {
      canvas: "#f1eff8",
      accent: "#4a3d9a",
      accentSurface: "#e0dcf4",
      messageSurface: "#dcd7f0",
    },
  },
  "grand-buildings": {
    dark: {
      canvas: "#14110e",
      accent: "#d4b483",
      accentSurface: "#4a3c2a",
      messageSurface: "#3a2e20",
    },
    light: {
      canvas: "#f5f1ea",
      accent: "#8a6430",
      accentSurface: "#eadcc4",
      messageSurface: "#e6d7bc",
    },
  },
};

function photoSetTheme(photoSetId: PhotoSetId): ThemeDefinition {
  const preview = PHOTO_SET_PREVIEW[photoSetId];
  return {
    ...WORLD_SCENERY_THEME,
    id: photoSetId,
    label: PHOTO_SETS.find((set) => set.id === photoSetId)?.label ?? WORLD_SCENERY_THEME.label,
    colors: { ...WORLD_SCENERY_THEME.colors, ...preview.dark },
    variants: { light: { ...WORLD_SCENERY_THEME.variants!.light!, ...preview.light } },
  };
}

function notifyAppearanceSaveFailure() {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title: "Couldn’t save appearance",
      description: "Try again.",
    }),
  );
}

function panesForTheme(theme: ThemeDefinition, appearanceMode: ThemeMode) {
  const card = getThemeCardDefinition(theme);
  const colorsFor = (appearance: "light" | "dark") =>
    previewColorsOf(card, appearance) ?? card.previews[0]!.colors;
  if (appearanceMode === "system") {
    return [
      { clip: "left" as const, colors: colorsFor("light") },
      { clip: "right" as const, colors: colorsFor("dark") },
    ];
  }
  return [{ colors: colorsFor(appearanceMode) }];
}

function ThemeChoiceCard({
  id,
  label,
  ariaLabel,
  selected,
  panes,
  onSelect,
}: {
  id?: string | undefined;
  label: string;
  ariaLabel: string;
  selected: boolean;
  panes: ReturnType<typeof panesForTheme>;
  onSelect: () => void;
}) {
  return (
    <button
      id={id}
      aria-label={ariaLabel}
      aria-pressed={selected}
      className={cn(
        "flex cursor-pointer flex-col items-stretch gap-1.5 rounded-xl border p-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-transparent bg-accent/30"
          : "border-border/70 bg-card/60 hover:bg-accent/10",
      )}
      style={selected ? { boxShadow: "inset 0 0 0 1px var(--ring)" } : undefined}
      onClick={onSelect}
      type="button"
    >
      <ThemeWireframe className="h-[8.75rem]" panes={panes} />
      <span
        className={cn(
          "flex items-center justify-center text-xs font-medium",
          selected ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
    </button>
  );
}

export function ThemeLibrary({
  appearanceMode,
  setAppearanceMode,
  theme,
  setTheme,
}: {
  appearanceMode: ThemeMode;
  setAppearanceMode: (mode: ThemeMode) => boolean;
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => boolean;
}) {
  const boring = isBoringChatTheme(theme);
  const photoSetId = usePhotoSetStore((state) => state.photoSetId);
  const setPhotoSetId = usePhotoSetStore((state) => state.setPhotoSetId);
  const schemeTheme = boring ? T3_CHAT_THEME : photoSetTheme(photoSetId);

  const setMode = (mode: ThemeMode) => {
    if (!setAppearanceMode(mode)) {
      notifyAppearanceSaveFailure();
    }
  };

  const selectPhotoSet = (next: PhotoSetId) => {
    setPhotoSetId(next);
    if (!setTheme(WORLD_SCENERY_THEME_ID)) {
      notifyAppearanceSaveFailure();
    }
  };

  const selectBoring = () => {
    if (!setTheme(T3_CHAT_THEME_ID)) {
      notifyAppearanceSaveFailure();
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3" id={searchableSetting("personalization").id} tabIndex={-1}>
        <div className="space-y-1 px-3 sm:px-4">
          <h3 className="text-sm font-medium tracking-[-0.005em] text-foreground">
            Personalization
          </h3>
          <p className="text-[13px] leading-[1.45] text-muted-foreground/80">
            Photo themes put a different kind of place behind the glass. Boring restores the
            original T3 Chat colors and turns the photos off.
          </p>
        </div>
        <div
          aria-label="Personalization"
          className="mx-auto grid w-full max-w-[56rem] grid-cols-2 gap-3 px-3 sm:px-4 sm:grid-cols-3"
          role="group"
        >
          {PHOTO_SETS.map((product) => (
            <ThemeChoiceCard
              ariaLabel={product.ariaLabel}
              id={product.id}
              key={product.id}
              label={product.label}
              onSelect={() => selectPhotoSet(product.id)}
              panes={panesForTheme(photoSetTheme(product.id), appearanceMode)}
              selected={!boring && photoSetId === product.id}
            />
          ))}
          <ThemeChoiceCard
            ariaLabel="Use Boring, the original T3 Chat colors without scenery photos"
            id={searchableSetting("boring-mode").id}
            label="Boring"
            onSelect={selectBoring}
            panes={panesForTheme(T3_CHAT_THEME, appearanceMode)}
            selected={boring}
          />
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="px-3 text-sm font-medium tracking-[-0.005em] text-foreground sm:px-4">
          Color scheme
        </h3>
        <div
          aria-label="Appearance mode"
          className="mx-auto grid w-full max-w-[56rem] grid-cols-3 gap-3 px-3 sm:px-4"
          role="group"
        >
          {(["system", "light", "dark"] as const).map((mode) => {
            const isActive = appearanceMode === mode;
            return (
              <ThemeChoiceCard
                ariaLabel={mode === "system" ? "Follow the system appearance" : `Use ${mode} mode`}
                key={mode}
                label={mode === "system" ? "System" : mode === "light" ? "Light" : "Dark"}
                onSelect={() => setMode(mode)}
                panes={
                  mode === "system"
                    ? panesForTheme(schemeTheme, "system")
                    : panesForTheme(schemeTheme, mode)
                }
                selected={isActive}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
