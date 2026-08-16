import React from "react";
import ReactDOM from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { createHashHistory, createBrowserHistory } from "@tanstack/react-router";

import "./index.css";

import { isElectron } from "./env";
import { ManagedRelayAuthProvider } from "./cloud/managedAuth";
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
const ElectronClerkRoot = React.lazy(() => import("./electronClerkRoot"));

// Electron loads the app from a file-backed shell, so hash history avoids path resolution issues.
const history = isElectron ? createHashHistory() : createBrowserHistory();

const router = getRouter(history);

if (isElectron) {
  syncDocumentElectronPlatformClasses(navigator.platform);
  syncDocumentWindowControlsOverlayClass();
}

const clerkPublishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

const app = <AppRoot router={router} />;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {clerkPublishableKey && hasCloudPublicConfig() ? (
      isElectron ? (
        <React.Suspense fallback={null}>
          <ElectronClerkRoot publishableKey={clerkPublishableKey}>
            <ManagedRelayAuthProvider>{app}</ManagedRelayAuthProvider>
          </ElectronClerkRoot>
        </React.Suspense>
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
