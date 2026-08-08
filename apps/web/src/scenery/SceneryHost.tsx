/**
 * Root mount for the World Scenery experience. Deliberately thin: the photo
 * engine (store, 400 KB seed pool, layer CSS) lives in a lazy chunk that only
 * loads once the "world-scenery" theme is actually the active palette, so the
 * stock app pays nothing at startup.
 *
 * Theme activation is observed through `data-theme-id` on <html> — the same
 * signal the palette CSS keys off — so this module needs no hooks into the
 * theme system's internals beyond installing its palette.
 */
import { lazy, Suspense, useEffect } from "react";

import { ComposerAttachControl } from "./ComposerAttachControl";
import { useSceneryThemeActive } from "./useHtmlAttributes";
import { ensureWorldSceneryThemeInstalled } from "./worldSceneryTheme";

const ActiveScenery = lazy(() => import("./ActiveScenery"));

export function SceneryHost() {
  const active = useSceneryThemeActive();

  useEffect(() => {
    ensureWorldSceneryThemeInstalled();
  }, []);

  return (
    <>
      {/* Theme-independent fork feature: the composer attach button. */}
      <ComposerAttachControl />
      {active ? (
        <Suspense fallback={null}>
          <ActiveScenery />
        </Suspense>
      ) : null}
    </>
  );
}
