import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useRef } from "react";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";

/**
 * Shared persisted shelf state for the compact Home list and iPad sidebar.
 * Refs advance before persistence starts so consecutive presses always toggle
 * the latest value, even if React has not rendered the optimistic patch yet.
 */
export function useThreadListV2ShelfPreferences() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const loaded = AsyncResult.isSuccess(preferencesResult);
  const snoozedShelfExpanded =
    loaded && preferencesResult.value.threadListSnoozedShelfExpanded === true;
  const storedShelfExpanded =
    loaded && preferencesResult.value.threadListStoredShelfExpanded === true;
  const settledShelfExpanded =
    loaded && preferencesResult.value.threadListSettledShelfExpanded === true;
  const snoozedShelfExpandedRef = useRef(snoozedShelfExpanded);
  const storedShelfExpandedRef = useRef(storedShelfExpanded);
  const settledShelfExpandedRef = useRef(settledShelfExpanded);
  snoozedShelfExpandedRef.current = snoozedShelfExpanded;
  storedShelfExpandedRef.current = storedShelfExpanded;
  settledShelfExpandedRef.current = settledShelfExpanded;

  const toggleSnoozedShelf = useCallback(() => {
    if (!loaded) return;
    const expanded = !snoozedShelfExpandedRef.current;
    snoozedShelfExpandedRef.current = expanded;
    savePreferences({ threadListSnoozedShelfExpanded: expanded });
  }, [loaded, savePreferences]);
  const toggleStoredShelf = useCallback(() => {
    if (!loaded) return;
    const expanded = !storedShelfExpandedRef.current;
    storedShelfExpandedRef.current = expanded;
    savePreferences({ threadListStoredShelfExpanded: expanded });
  }, [loaded, savePreferences]);
  const toggleSettledShelf = useCallback(() => {
    if (!loaded) return;
    const expanded = !settledShelfExpandedRef.current;
    settledShelfExpandedRef.current = expanded;
    savePreferences({ threadListSettledShelfExpanded: expanded });
  }, [loaded, savePreferences]);

  return {
    loaded,
    settledShelfExpanded,
    snoozedShelfExpanded,
    storedShelfExpanded,
    toggleSettledShelf,
    toggleSnoozedShelf,
    toggleStoredShelf,
  } as const;
}
