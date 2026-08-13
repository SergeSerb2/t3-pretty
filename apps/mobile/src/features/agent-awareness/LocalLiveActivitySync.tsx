import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect } from "react";
import { Platform } from "react-native";

import { useProjects, useThreadShells } from "../../state/entities";
import { mobilePreferencesAtom } from "../../state/preferences";
import { buildLocalLiveActivityProps } from "./localLiveActivity";
import { applyLocalLiveActivityProps } from "./remoteRegistration";

/**
 * Keeps the iOS Live Activity in sync with threads this phone can already
 * see. Remote APNs updates still cover other environments and the suspended
 * app; this is the path that actually moves the card during local work.
 */
export function LocalLiveActivitySync() {
  const threads = useThreadShells();
  const projects = useProjects();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);

  useEffect(() => {
    if (Platform.OS !== "ios") {
      return;
    }
    if (!AsyncResult.isSuccess(preferencesResult)) {
      return;
    }
    if (preferencesResult.value.liveActivitiesEnabled === false) {
      return;
    }
    const props = buildLocalLiveActivityProps({
      threads,
      projects,
      nowMs: Date.now(),
    });
    if (props === null) {
      return;
    }
    applyLocalLiveActivityProps(props);
  }, [threads, projects, preferencesResult]);

  return null;
}
