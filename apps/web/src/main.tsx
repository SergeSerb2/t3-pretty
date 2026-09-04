import React from "react";
import ReactDOM from "react-dom/client";

import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "./index.css";

import { isElectron } from "./env";
import { ManagedRelayAuthProvider } from "./cloud/managedAuth";
import { isClerkGateOpen, useClerkGateOpen } from "./cloud/clerkGate";
import { hasCloudPublicConfig } from "./cloud/publicConfig";
import { getRouter } from "./router";
import {
  syncDocumentElectronPlatformClasses,
  syncDocumentWindowControlsOverlayClass,
} from "./lib/windowControlsOverlay";
import { AppRoot } from "./AppRoot";
import { clearChunkReloadGuard, reloadOnceForChunkLoadError } from "./lib/chunkReloadGuard";

// The Electron provider bundles all of clerk-js; only the desktop renderer
// pays for it. The provider wraps the whole tree, so the tree shape must be
// identical before and after it resolves — hence a null fallback rather than
// rendering the app unwrapped and remounting it once the chunk lands.
const loadElectronClerkRoot = () => import("./electronClerkRoot");
const LazyElectronClerkRoot = React.lazy(loadElectronClerkRoot);

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
// Hosted web keeps real paths for OAuth callbacks and pairing links; its static host serves the
// built 404.html fallback for direct route loads.
const history = isElectron ? createHashHistory() : createBrowserHistory();

const router = getRouter(history, import.meta.env.BASE_URL);

if (isElectron) {
  syncDocumentElectronPlatformClasses(navigator.platform);
  syncDocumentWindowControlsOverlayClass();
}

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

// A failed split-chunk fetch usually means the hashed assets went stale under
// a deploy; one guarded reload picks up the fresh index.html.
let chunkLoadFailed = false;
let reloadScheduled = false;
window.addEventListener("vite:preloadError", (event) => {
  chunkLoadFailed = true;
  if (reloadOnceForChunkLoadError()) {
    reloadScheduled = true;
    event.preventDefault();
  }
});

const app = <AppRoot router={router} />;

// Hosted cloud auth is loaded before first paint so the root tree stays
// stable. Electron keeps the fork's persistent gate and only fetches its much
// larger Clerk runtime after a sign-in surface opens the gate.
const browserManagedAuthShellModule =
  clerkPublishableKey && hasCloudPublicConfig() && !isElectron
    ? import("./components/clerk/BrowserManagedAuthShell")
    : null;

// A returning signed-in Electron session needs Clerk on the first commit. Wait
// for that split chunk while the boot shell is still visible; signed-out local
// sessions keep it entirely off their startup path.
const initialElectronClerkRootModule =
  clerkPublishableKey && hasCloudPublicConfig() && isElectron && isClerkGateOpen()
    ? loadElectronClerkRoot()
    : null;

// Desktop installs without a cloud session render the app unwrapped so the
// clerk-js chunk never loads; the gate opens from a sign-in surface (and stays
// open across launches), which mounts the provider and remounts the tree once.
function ElectronRoot({
  publishableKey,
  initialClerkRoot,
}: {
  publishableKey: string;
  initialClerkRoot: React.ComponentType<{
    publishableKey: string;
    children: React.ReactNode;
  }> | null;
}) {
  if (!useClerkGateOpen()) return app;
  const ClerkRoot = initialClerkRoot ?? LazyElectronClerkRoot;

  return (
    <React.Suspense fallback={null}>
      <ClerkRoot publishableKey={publishableKey}>
        <ManagedRelayAuthProvider>{app}</ManagedRelayAuthProvider>
      </ClerkRoot>
    </React.Suspense>
  );
}

// The index.html boot splash lives above #root. Resolve everything that first
// commit needs before rendering, then dissolve the splash after the app has
// painted instead of exposing a blank window while chunks download.
export const startup = Promise.all([
  browserManagedAuthShellModule?.then((module) => module.default) ?? null,
  initialElectronClerkRootModule?.then((module) => module.default) ?? null,
  router.load(),
])
  .then(([BrowserManagedAuthShell, InitialElectronClerkRoot]) => {
    // A route chunk failure still resolves router.load(): the error is parked in
    // the lazy component and surfaces through the route error boundary. Skip the
    // paint when a reload is on its way, and only re-arm the guard after a boot
    // that fetched every chunk it asked for.
    if (reloadScheduled) return;
    if (!chunkLoadFailed) clearChunkReloadGuard();
    ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
      <React.StrictMode>
        {clerkPublishableKey && hasCloudPublicConfig() ? (
          isElectron ? (
            <ElectronRoot
              publishableKey={clerkPublishableKey}
              initialClerkRoot={InitialElectronClerkRoot}
            />
          ) : BrowserManagedAuthShell ? (
            <BrowserManagedAuthShell publishableKey={clerkPublishableKey}>
              {app}
            </BrowserManagedAuthShell>
          ) : (
            app
          )
        ) : (
          app
        )}
      </React.StrictMode>,
    );

    // The shell is intentionally outside #root, so React cannot clear it.
    // Remove it only after the first commit has painted (the double rAF), and
    // retain a timeout for hidden windows where transitionend may not fire.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.dataset.booted = "true";
        const bootShell = document.getElementById("boot-shell");
        if (!bootShell) return;
        const removeBootShell = () => bootShell.remove();
        bootShell.addEventListener("transitionend", removeBootShell, { once: true });
        window.setTimeout(removeBootShell, 600);
      });
    });
  })
  .catch((error: unknown) => {
    // Let the bootstrap entry show the error unless a reload is already scheduled.
    if (reloadScheduled) return;
    throw error;
  });
