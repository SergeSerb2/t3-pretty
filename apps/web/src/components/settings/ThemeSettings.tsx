import { cn } from "../../lib/utils";
import { WORLD_SCENERY_THEME } from "../../scenery/worldSceneryTheme";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { getThemeCardDefinition, previewColorsOf, type ThemeMode } from "./ThemePreviewCircles";
import { ThemeWireframe } from "./ThemeWireframe";

const WORLD_SCENERY_CARD = getThemeCardDefinition(WORLD_SCENERY_THEME);

export function ThemeLibrary({
  appearanceMode,
  setAppearanceMode,
}: {
  appearanceMode: ThemeMode;
  setAppearanceMode: (mode: ThemeMode) => boolean;
}) {
  const colorsFor = (appearance: "light" | "dark") =>
    previewColorsOf(WORLD_SCENERY_CARD, appearance) ?? WORLD_SCENERY_CARD.previews[0]!.colors;

  const setMode = (mode: ThemeMode) => {
    if (!setAppearanceMode(mode)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Couldn’t save appearance",
          description: "Try again.",
        }),
      );
    }
  };

  return (
    <div className="space-y-3">
      <p className="px-3 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
        Choose light, dark, or follow the system. T3 Pretty uses the World Scenery palette.
      </p>
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
            <button
              aria-label={mode === "system" ? "Follow the system appearance" : `Use ${mode} mode`}
              aria-pressed={isActive}
              className={cn(
                "flex cursor-pointer flex-col items-stretch gap-1.5 rounded-xl border p-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "border-transparent bg-accent/30"
                  : "border-border/70 bg-card/60 hover:bg-accent/10",
              )}
              key={mode}
              style={isActive ? { boxShadow: "inset 0 0 0 1px var(--ring)" } : undefined}
              onClick={() => setMode(mode)}
              type="button"
            >
              <ThemeWireframe
                className="h-[8.75rem]"
                panes={
                  mode === "system"
                    ? [
                        { clip: "left", colors: colorsFor("light") },
                        { clip: "right", colors: colorsFor("dark") },
                      ]
                    : [{ colors: colorsFor(mode) }]
                }
              />
              <span
                className={cn(
                  "flex items-center justify-center text-xs font-medium",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {mode === "system" ? "System" : mode === "light" ? "Light" : "Dark"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
