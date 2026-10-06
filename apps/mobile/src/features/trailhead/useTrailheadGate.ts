import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useNavigation } from "@react-navigation/native";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useRef } from "react";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useConnectionsReady, useWorkspaceEnvironments } from "../../state/workspace";
import { resolveTrailheadGate } from "./trailhead.logic";

/**
 * Decides once per app session whether to open Trailhead. Runs inside
 * RootStackLayout; installs that already have a connection are marked done
 * without ever seeing it.
 */
export function useTrailheadGate(): void {
  const navigation = useNavigation();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const catalogReady = useConnectionsReady();
  const hasConnections = useWorkspaceEnvironments().length > 0;
  const decidedRef = useRef(false);

  useEffect(() => {
    if (decidedRef.current) return;
    const preferencesLoaded = AsyncResult.isSuccess(preferencesResult);
    const decision = resolveTrailheadGate({
      preferencesLoaded,
      onboardingCompletedAt: preferencesLoaded
        ? preferencesResult.value.onboardingCompletedAt
        : undefined,
      catalogReady,
      hasConnections,
    });
    if (decision === "wait") return;
    decidedRef.current = true;
    if (decision === "acknowledge") {
      savePreferences({ onboardingCompletedAt: new Date().toISOString() });
    } else if (decision === "show") {
      navigation.navigate("Trailhead");
    }
  }, [catalogReady, hasConnections, navigation, preferencesResult, savePreferences]);
}
