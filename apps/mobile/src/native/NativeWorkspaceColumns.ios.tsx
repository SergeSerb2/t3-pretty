import { requireOptionalNativeModule } from "expo";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useNativeLayoutMetrics } from "./native-layout-metrics";
import {
  NATIVE_WORKSPACE_COLUMNS_READY_TIMEOUT_MS,
  nativeWorkspaceColumnsAreReady,
} from "./native-workspace-columns-ready";

const nativeControls = requireOptionalNativeModule<{
  readonly supportsWorkspaceColumns?: boolean;
  readonly ViewPrototypes?: { readonly T3NativeControls_LayoutMetrics?: unknown };
}>("T3NativeControls");
export const NATIVE_WORKSPACE_COLUMNS_SUPPORTED =
  Platform.OS === "ios" && Platform.isPad && nativeControls?.supportsWorkspaceColumns === true;

export function useNativeWorkspaceColumnsReady() {
  const metrics = useNativeLayoutMetrics();
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (metrics !== null) return;
    const timer = setTimeout(() => setTimedOut(true), NATIVE_WORKSPACE_COLUMNS_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [metrics]);
  // Choose the phone's native host before attaching any screens. Older clients
  // without the observer can immediately use the compact navigator. Build 190+
  // advertises LayoutMetrics; if the native view never publishes (iOS 27.1
  // hinge wait), fail open so the root is not a white screen.
  return nativeWorkspaceColumnsAreReady({
    isPad: Platform.OS === "ios" && Platform.isPad,
    hasLayoutMetricsPrototype: Boolean(
      nativeControls?.ViewPrototypes?.T3NativeControls_LayoutMetrics,
    ),
    hasMetrics: metrics !== null,
    timedOut,
  });
}

export function useNativeWorkspaceColumnsSupported() {
  const metrics = useNativeLayoutMetrics();
  return (
    NATIVE_WORKSPACE_COLUMNS_SUPPORTED ||
    (nativeControls?.supportsWorkspaceColumns === true && metrics?.hasHinge === true)
  );
}
