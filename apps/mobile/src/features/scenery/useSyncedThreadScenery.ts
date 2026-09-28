/**
 * Shows the photo stored on the thread, and publishes this device's pick
 * when the thread does not have one for the active catalog yet.
 */
import { useEffect, useRef } from "react";

import { connectionProjectionPhase } from "@t3tools/client-runtime/connection";
import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  mayPublishThreadScenery,
  resolveSharedSceneryPhotoSet,
  serverSceneryMatchesPhotoSet,
} from "@t3tools/client-runtime/state/scenery-sync";
import { supportsSharedSettingsSync } from "@t3tools/client-runtime/state/shared-settings";
import type { ThreadSceneryAssignment } from "@t3tools/contracts";

import { environmentCatalog } from "../../connection/catalog";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentServerConfig, useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { DEFAULT_PHOTO_SET_ID } from "./photoSets";
import type { SceneryPhoto } from "./sceneryLogic";
import { useScenery } from "./SceneryProvider";

function photoFromServerScenery(scenery: ThreadSceneryAssignment): SceneryPhoto {
  return {
    id: scenery.photoId,
    name: scenery.name,
    averageColorHex: scenery.averageColorHex,
    heroURL: scenery.heroURL,
    thumbURL: scenery.thumbURL,
    rawURL: scenery.rawURL,
    downloadLocationURL: scenery.downloadLocationURL,
    photographerName: scenery.photographerName,
    photographerProfileURL: scenery.photographerProfileURL,
  };
}

export function useSyncedThreadSceneryPhoto(threadKey: string | null): SceneryPhoto | null {
  const { assignments, photoSetId, photoForThreadKey } = useScenery();
  const { environments } = useEnvironments();
  const ref = threadKey === null ? null : parseScopedThreadKey(threadKey);
  const shell = useThreadShell(ref);
  const serverConfig = useEnvironmentServerConfig(ref?.environmentId ?? null);
  const connection = useEnvironmentQuery(
    ref === null ? null : environmentCatalog.stateAtom(ref.environmentId),
  );
  const assignScenery = useAtomCommand(threadEnvironment.assignScenery, {
    label: "thread scenery assign",
    reportFailure: false,
  });
  const attemptKey = useRef<string | null>(null);
  const serverScenery = shell?.scenery ?? null;
  const serverPhoto =
    serverScenery !== null && serverSceneryMatchesPhotoSet(serverScenery.photoSetId, photoSetId)
      ? photoFromServerScenery(serverScenery)
      : null;
  const sharedPhotoSetId = resolveSharedSceneryPhotoSet({
    primaryEnvironmentId: null,
    sources: environments.map((environment) => ({
      environmentId: environment.environmentId,
      syncEligible: supportsSharedSettingsSync(environment),
      sceneryPhotoSet: environment.serverConfig?.settings.sceneryPhotoSet,
    })),
  });
  const connectionReady =
    connection.data !== null && connectionProjectionPhase(connection.data) === "ready";
  const supportsScenery = serverConfig?.environment.capabilities.threadScenery === true;

  useEffect(() => {
    const assignment = threadKey === null ? undefined : assignments[threadKey];
    const assignmentSet = assignment?.photoSetId ?? DEFAULT_PHOTO_SET_ID;
    if (
      threadKey === null ||
      ref === null ||
      shell === null ||
      serverPhoto !== null ||
      assignment === undefined ||
      assignmentSet !== photoSetId ||
      !connectionReady ||
      !supportsScenery ||
      !mayPublishThreadScenery({ sharedPhotoSetId, localPhotoSetId: photoSetId })
    ) {
      return;
    }
    const photo = photoForThreadKey(threadKey);
    if (photo === null) return;
    const key = `${ref.environmentId}:${ref.threadId}:${photoSetId}:${photo.id}`;
    if (attemptKey.current === key) return;
    attemptKey.current = key;
    void assignScenery({
      environmentId: ref.environmentId,
      input: {
        threadId: ref.threadId,
        scenery: {
          photoId: photo.id,
          name: photo.name,
          averageColorHex: photo.averageColorHex,
          heroURL: photo.heroURL,
          thumbURL: photo.thumbURL,
          rawURL: photo.rawURL,
          downloadLocationURL: photo.downloadLocationURL,
          photographerName: photo.photographerName,
          photographerProfileURL: photo.photographerProfileURL,
          photoSetId,
        },
      },
    });
  }, [
    assignScenery,
    assignments,
    connectionReady,
    photoForThreadKey,
    photoSetId,
    ref,
    serverPhoto,
    shell,
    sharedPhotoSetId,
    supportsScenery,
    threadKey,
  ]);

  return serverPhoto;
}
