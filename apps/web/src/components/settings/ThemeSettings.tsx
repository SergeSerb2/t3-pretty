import { cn } from "../../lib/utils";
import { isBoringChatTheme } from "../../scenery/productTheme";
import { WORLD_SCENERY_THEME, WORLD_SCENERY_THEME_ID } from "../../scenery/worldSceneryTheme";
import {
  T3_CHAT_THEME,
  T3_CHAT_THEME_ID,
  type ThemeDefinition,
  type ThemePreference,
} from "../../themePalette";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { searchableSetting } from "./settingsSearch";
import { getThemeCardDefinition, previewColorsOf, type ThemeMode } from "./ThemePreviewCircles";
import { ThemeWireframe } from "./ThemeWireframe";

const PRODUCT_THEMES = [
  {
    id: WORLD_SCENERY_THEME_ID,
    label: "World Scenery",
    ariaLabel: "Use World Scenery",
    theme: WORLD_SCENERY_THEME,
  },
  {
    id: T3_CHAT_THEME_ID,
    label: "Boring",
    ariaLabel: "Use Boring, the original T3 Chat colors without World Scenery photos",
    theme: T3_CHAT_THEME,
  },
] as const;

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
  const schemeTheme = boring ? T3_CHAT_THEME : WORLD_SCENERY_THEME;

  const setMode = (mode: ThemeMode) => {
    if (!setAppearanceMode(mode)) {
      notifyAppearanceSaveFailure();
    }
  };

  const setProductTheme = (next: ThemePreference) => {
    if (!setTheme(next)) {
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
            World Scenery is the default. Boring restores the original T3 Chat colors and turns the
            landscape photos off.
          </p>
        </div>
        <div
          aria-label="Personalization"
          className="mx-auto grid w-full max-w-[56rem] grid-cols-2 gap-3 px-3 sm:px-4"
          role="group"
        >
          {PRODUCT_THEMES.map((product) => {
            const selected = product.id === T3_CHAT_THEME_ID ? boring : !boring;
            return (
              <ThemeChoiceCard
                ariaLabel={product.ariaLabel}
                id={
                  product.id === T3_CHAT_THEME_ID ? searchableSetting("boring-mode").id : undefined
                }
                key={product.id}
                label={product.label}
                onSelect={() => setProductTheme(product.id)}
                panes={panesForTheme(product.theme, appearanceMode)}
                selected={selected}
              />
            );
          })}        </div>
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
