import { RouterProvider } from "@tanstack/react-router";

import { ElectronBrowserHost } from "./browser/ElectronBrowserHost";
import { SurgeConnectMeshSync } from "./cloud/SurgeConnectMeshSync";
import { useCloudUiEnabled } from "./cloud/clerkGate";
import { PreviewAutomationHosts } from "./components/preview/PreviewAutomationHosts";
import { ContextMenuHost } from "./components/ContextMenuHost";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { isElectron } from "./env";
import { AppAtomRegistryProvider } from "./rpc/atomRegistry";
import type { AppRouter } from "./router";

/**
 * Owns renderer-wide providers. The Electron browser host intentionally sits
 * outside the router so its webviews survive route transitions, but it must
 * share the same atom registry as routed UI.
 */
export function AppRoot({ router }: { readonly router: AppRouter }) {
  const cloudUiEnabled = useCloudUiEnabled();

  return (
    <AppAtomRegistryProvider>
      {isElectron && cloudUiEnabled ? <SurgeConnectMeshSync /> : null}
      <RouterProvider router={router} />
      <PreviewAutomationHosts />
      <ElectronBrowserHost />
      <ContextMenuHost />
      <QuitHoldOverlay />
    </AppAtomRegistryProvider>
  );
}
