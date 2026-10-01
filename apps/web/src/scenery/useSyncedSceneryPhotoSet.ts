/**
 * Keeps the scenery photo catalog aligned across Surge Connect machines.
 * The choice lives on each connected server. This device follows a published
 * choice, and publishes its own only when nobody else has chosen yet.
 */
import { supportsSharedSettingsSync } from "@t3tools/client-runtime/state/shared-settings";
import {
  resolveSharedSceneryPhotoSet,
  shouldPublishLocalSceneryPhotoSet,
} from "@t3tools/client-runtime/state/scenery-sync";
import { useCallback, useEffect, useState } from "react";

import { useUpdatePrimarySettings } from "../hooks/useSettings";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { DEFAULT_PHOTO_SET_ID, parsePhotoSetId, type PhotoSetId } from "./photoSets";
import { usePhotoSetStore } from "./photoSetStore";

let liftedLocalPhotoSet: string | null = null;

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
