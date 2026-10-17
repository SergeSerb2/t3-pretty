import { useEffect, useRef, useSyncExternalStore } from "react";
import type { SceneryAppearance } from "@t3tools/contracts/settings";
import { supportsSharedSettingsSync } from "@t3tools/client-runtime/state/shared-settings";

import { useUpdatePrimarySettings } from "../hooks/useSettings";
import { useEnvironments } from "../state/environments";
import { DEFAULT_TRANSLUCENCY } from "./glass";
import { DEFAULT_BLUR, useSceneryStore } from "./sceneryStore";
import { useSharedSceneryAppearance } from "./useSyncedSceneryPhotoSet";

const subscribeHydration = (onChange: () => void) =>
  useSceneryStore.persist.onFinishHydration(onChange);
const hasHydrated = () => useSceneryStore.persist.hasHydrated();

/** Mounted with the photo engine so Boring mode does not load the scenery pool. */
export function useSyncedSceneryAppearance() {
  const { blur, translucency } = useSharedSceneryAppearance();
  const updateSettings = useUpdatePrimarySettings();
  const { environments } = useEnvironments();
  const canPublish = environments.some(
    (environment) =>
      supportsSharedSettingsSync(environment) &&
      environment.serverConfig?.environment.capabilities.sceneryAppearance === true,
  );
  const hydrated = useSyncExternalStore(subscribeHydration, hasHydrated, () => false);
  const lastSharedAppearance = useRef<SceneryAppearance | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    const local = useSceneryStore.getState();
    const previous = lastSharedAppearance.current;
    lastSharedAppearance.current = {
      ...(blur === undefined ? {} : { blur }),
      ...(translucency === undefined ? {} : { translucency }),
    };
    const migration: { blur?: number; translucency?: number } = {};
    if (blur !== undefined) {
      if (previous?.blur !== blur && local.blur !== blur) local.setBlur(blur);
    } else if (local.blur !== DEFAULT_BLUR) {
      migration.blur = local.blur;
    }
    if (translucency !== undefined) {
      if (previous?.translucency !== translucency && local.translucency !== translucency) {
        local.setTranslucency(translucency);
      }
    } else if (local.translucency !== DEFAULT_TRANSLUCENCY) {
      migration.translucency = local.translucency;
    }
    if (canPublish && Object.keys(migration).length > 0) {
      updateSettings({ sceneryAppearance: migration });
    }
  }, [blur, canPublish, hydrated, translucency, updateSettings]);
}
