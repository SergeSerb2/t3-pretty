/**
 * Keeps the scenery photo catalog aligned across Surge Connect machines.
 * The choice lives on each connected server. This device follows a published
 * choice, and publishes its own only when nobody else has chosen yet.
 */
import { supportsSharedSettingsSync } from "@t3tools/client-runtime/state/shared-settings";
import {
  resolveSharedSceneryAppearance,
  resolveSharedSceneryPhotoSet,
  shouldPublishLocalSceneryPhotoSet,
} from "@t3tools/client-runtime/state/scenery-sync";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  persistClientSettingsPatch,
  getClientSettings,
  useClientSettingsHydrated,
  useUpdatePrimarySettings,
} from "../hooks/useSettings";
import { DEFAULT_CLIENT_SETTINGS, type SceneryAppearance } from "@t3tools/contracts/settings";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { DEFAULT_PHOTO_SET_ID, parsePhotoSetId, type PhotoSetId } from "./photoSets";
import { usePhotoSetStore } from "./photoSetStore";

let liftedLocalPhotoSet: string | null = null;

/** Keep slider feedback local and publish one combined patch after a drag pauses. */
export function usePublishSceneryAppearance() {
  const updateSettings = useUpdatePrimarySettings();
  const writer = useRef(updateSettings);
  useEffect(() => {
    writer.current = updateSettings;
  }, [updateSettings]);
  const pending = useRef<SceneryAppearance>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length > 0) writer.current({ sceneryAppearance: patch });
  }, []);
  useEffect(() => () => flush(), [flush]);
  return useCallback(
    (patch: SceneryAppearance) => {
      pending.current = { ...pending.current, ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 250);
    },
    [flush],
  );
}

export function useSharedSceneryAppearance() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return resolveSharedSceneryAppearance({
    primaryEnvironmentId,
    sources: environments.map((environment) => ({
      environmentId: environment.environmentId,
      syncEligible:
        supportsSharedSettingsSync(environment) &&
        environment.serverConfig?.environment.capabilities.sceneryAppearance === true,
      sceneryAppearance: environment.serverConfig?.settings.sceneryAppearance,
    })),
  });
}

export function useSyncedAppearanceContrast() {
  const { contrast } = useSharedSceneryAppearance();
  const hydrated = useClientSettingsHydrated();
  const updateSettings = useUpdatePrimarySettings();
  const { environments } = useEnvironments();
  const canPublish = environments.some(
    (environment) =>
      supportsSharedSettingsSync(environment) &&
      environment.serverConfig?.environment.capabilities.sceneryAppearance === true,
  );
  const lastSharedContrast = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!hydrated) return;
    const localContrast = getClientSettings().appearanceContrast;
    const previous = lastSharedContrast.current;
    lastSharedContrast.current = contrast;
    if (contrast !== undefined) {
      if (contrast !== previous && contrast !== localContrast) {
        void persistClientSettingsPatch({ appearanceContrast: contrast });
      }
    } else if (canPublish && localContrast !== DEFAULT_CLIENT_SETTINGS.appearanceContrast) {
      updateSettings({ sceneryAppearance: { contrast: localContrast } });
    }
  }, [canPublish, contrast, hydrated, updateSettings]);
}

export function useSyncedSceneryPhotoSet(): string | null {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const updateSettings = useUpdatePrimarySettings();
  const [hydrated, setHydrated] = useState(() => usePhotoSetStore.persist.hasHydrated());

  useEffect(() => {
    if (usePhotoSetStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return usePhotoSetStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
  }, []);

  const sharedPhotoSetId = resolveSharedSceneryPhotoSet({
    primaryEnvironmentId,
    sources: environments.map((environment) => ({
      environmentId: environment.environmentId,
      syncEligible: supportsSharedSettingsSync(environment),
      sceneryPhotoSet: environment.serverConfig?.settings.sceneryPhotoSet,
    })),
  });

  const canPublish = environments.some(
    (environment) =>
      environment.serverConfig?.environment.capabilities.sceneryPhotoSet === true &&
      (environment.environmentId === primaryEnvironmentId ||
        supportsSharedSettingsSync(environment)),
  );

  useEffect(() => {
    if (!hydrated) return;
    const localPhotoSetId = usePhotoSetStore.getState().photoSetId;
    if (sharedPhotoSetId !== null) {
      const shared = parsePhotoSetId(sharedPhotoSetId);
      if (shared !== localPhotoSetId) {
        usePhotoSetStore.getState().setPhotoSetId(shared);
      }
      return;
    }
    if (
      !canPublish ||
      !shouldPublishLocalSceneryPhotoSet({
        sharedPhotoSetId,
        localPhotoSetId,
        defaultPhotoSetId: DEFAULT_PHOTO_SET_ID,
      }) ||
      liftedLocalPhotoSet === localPhotoSetId
    ) {
      return;
    }
    liftedLocalPhotoSet = localPhotoSetId;
    updateSettings({ sceneryPhotoSet: localPhotoSetId });
  }, [canPublish, hydrated, sharedPhotoSetId, updateSettings]);

  return sharedPhotoSetId;
}

export function usePublishSceneryPhotoSet(): (photoSetId: PhotoSetId) => void {
  const updateSettings = useUpdatePrimarySettings();
  return useCallback(
    (photoSetId: PhotoSetId) => {
      liftedLocalPhotoSet = photoSetId;
      updateSettings({ sceneryPhotoSet: photoSetId });
    },
    [updateSettings],
  );
}
