/**
 * Root mount for the World Scenery experience. Deliberately thin: the photo
 * engine (store, 400 KB seed pool, layer CSS) lives in a lazy chunk that only
 * loads once the "world-scenery" theme is actually the active palette.
 *
 * T3 Pretty ships World Scenery as the default product theme and Boring
 * (upstream T3 Chat) as the opt-out. This host installs the scenery palette
 * and snaps any other stored preference to World Scenery. Activation is then
 * observed through `data-theme-id` on <html>.
 */
import { lazy, Suspense, useEffect } from "react";

import { useTheme } from "../hooks/useTheme";
import { shouldForceWorldSceneryTheme } from "./productTheme";
import { useSceneryThemeActive } from "./useHtmlAttributes";
import { ensureWorldSceneryThemeInstalled, WORLD_SCENERY_THEME_ID } from "./worldSceneryTheme";

const ActiveScenery = lazy(() => import("./ActiveScenery"));
const SceneryMotion = lazy(() => import("./SceneryMotion"));

export function SceneryHost() {
  const active = useSceneryThemeActive();
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    ensureWorldSceneryThemeInstalled();
    if (shouldForceWorldSceneryTheme(theme)) {
      setTheme(WORLD_SCENERY_THEME_ID);
    }
  }, [setTheme, theme]);

  return (
    <>
      {/* Theme-independent fork feature: thread motion.
          Lazy so the observer and motion.css stay out of the startup chunk. */}
      <Suspense fallback={null}>
        <SceneryMotion />
      </Suspense>
      {active ? (
        <Suspense fallback={null}>
          <ActiveScenery />
        </Suspense>
      ) : null}
    </>
  );
}
