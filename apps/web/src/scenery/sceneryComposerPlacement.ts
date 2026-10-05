export type SceneryComposerPlacement = "hero" | "docked";

const SCENERY_COMPOSER_ATTR = "sceneryComposer";

export function writeSceneryComposerPlacement(placement: SceneryComposerPlacement | null): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (placement === null) {
    delete root.dataset[SCENERY_COMPOSER_ATTR];
    return;
  }
  if (root.dataset[SCENERY_COMPOSER_ATTR] === placement) {
    return;
  }
  root.dataset[SCENERY_COMPOSER_ATTR] = placement;
}
