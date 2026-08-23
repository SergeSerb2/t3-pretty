import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";

import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "./index.css";

import { isElectron } from "./env";
import { ManagedRelayAuthProvider } from "./cloud/managedAuth";
import { useClerkGateOpen } from "./cloud/clerkGate";
import { hasCloudPublicConfig } from "./cloud/publicConfig";
import { getRouter } from "./router";
import {
  syncDocumentElectronPlatformClasses,
  syncDocumentWindowControlsOverlayClass,
} from "./lib/windowControlsOverlay";
import { AppRoot } from "./AppRoot";
import { clerkAppearance } from "./components/clerk/clerkAppearance";

// The Electron provider bundles all of clerk-js; only the desktop renderer
// pays for it. The provider wraps the whole tree, so the tree shape must be
// identical before and after it resolves — hence a null fallback rather than
// rendering the app unwrapped and remounting it once the chunk lands.
const ElectronClerkRoot = React.lazy(async () => {
  const { passkeys } = await import("@clerk/electron/passkeys");
  const { ClerkProvider: ElectronClerkProvider } = await import("@clerk/electron/react");

  // First Clerk UI build containing https://github.com/clerk/javascript/pull/9500.
  const electronClerkUI = {
    __internal_clerkUIVersion: "1.30.5-canary.v20260819050620",
  };

  function ElectronClerkProviderRoot({
    children,
    publishableKey,
  }: {
    children: React.ReactNode;
    publishableKey: string;
  }) {
    return (
      <ElectronClerkProvider
        {...electronClerkUI}
        appearance={clerkAppearance}
        publishableKey={publishableKey}
        passkeys={passkeys}
      >
        {children}
      </ElectronClerkProvider>
    );
  }

  return { default: ElectronClerkProviderRoot };
});

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
const history =
  isElectron || import.meta.env.VITE_STATIC_HOSTED_APP
    ? createHashHistory()
    : createBrowserHistory();

const router = getRouter(history);

if (isElectron) {
  syncDocumentElectronPlatformClasses(navigator.platform);
  syncDocumentWindowControlsOverlayClass();
}

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

const app = <AppRoot router={router} />;

// Desktop installs without a cloud session render the app unwrapped so the
// clerk-js chunk never loads; the gate opens from a sign-in surface (and stays
// open across launches), which mounts the provider and remounts the tree once.
function ElectronRoot({ publishableKey }: { publishableKey: string }) {
  if (!useClerkGateOpen()) return app;

  return (
    <React.Suspense fallback={null}>
      <ElectronClerkRoot publishableKey={publishableKey}>
        <ManagedRelayAuthProvider>{app}</ManagedRelayAuthProvider>
      </ElectronClerkRoot>
    </React.Suspense>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {clerkPublishableKey && hasCloudPublicConfig() ? (
      isElectron ? (
        <ElectronRoot publishableKey={clerkPublishableKey} />
      ) : (
        <ClerkProvider appearance={clerkAppearance} publishableKey={clerkPublishableKey}>
          <ManagedRelayAuthProvider>{app}</ManagedRelayAuthProvider>
        </ClerkProvider>
      )
    ) : (
      app
    )}
  </React.StrictMode>,
);

// Dissolve the boot logo over the app once the first commit has painted (the
// double rAF): index.html transitions #boot-shell out on data-booted, and the
// node is removed when the fade ends (timeout in case transitionend is
// skipped, e.g. a hidden window).
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
