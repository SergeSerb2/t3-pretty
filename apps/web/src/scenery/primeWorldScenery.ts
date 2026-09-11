/**
 * Thin entry from the new-thread path. Does not import the seed pool: the
 * photo engine stays in the lazy scenery chunk and only loads when World
 * Scenery is actually the active theme.
 */
import { requestSceneryArrival } from "./sceneryArrivalLogic";
import { WORLD_SCENERY_THEME_ID } from "./worldSceneryTheme";

export function primeWorldSceneryForNewThread(threadKey: string): void {
  if (typeof document === "undefined") {
    return;
  }
  if (document.documentElement.dataset.themeId !== WORLD_SCENERY_THEME_ID) {
    return;
  }
  requestSceneryArrival(threadKey);
  // Priming is best-effort. A transient lazy-chunk failure must not surface as
  // an unhandled rejection from the synchronous new-thread action.
  void import("./primeScenery").then(
    (mod) => {
      mod.primeSceneryForThread(threadKey);
    },
    () => undefined,
  );
}
