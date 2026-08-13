import { BlurTargetView } from "expo-blur";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { StatusBar, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { createStaticNavigation, DarkTheme, DefaultTheme } from "@react-navigation/native";

// World Scenery nav palette — keep in step with global.css (native headers
// cannot read CSS variables, so the scenery screen/accent hexes repeat here).
const SCENERY_NAV_DARK = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: "#0e1110", card: "#0e1110", primary: "#91c9a3" },
};
const SCENERY_NAV_LIGHT = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: "#f4f6f4", card: "#f4f6f4", primary: "#27633f" },
};

import { RegistryContext } from "@effect/atom-react";
import { ConfirmDialogHost } from "./components/ConfirmDialogHost";
import { AppMenuHost } from "./components/AppMenuHost";
import { WhatsNewHost } from "./features/whats-new/WhatsNewHost";
import { LocalLiveActivitySync } from "./features/agent-awareness/LocalLiveActivitySync";
import { CloudAuthProvider } from "./features/cloud/CloudAuthProvider";
import { prepareNativeShowcaseCapture } from "./features/showcase/nativeShowcaseScene";
import { IncomingShareProvider } from "./features/sharing/IncomingShareProvider";
import {
  AppearancePreferencesProvider,
  useAppearancePreferences,
} from "./features/settings/appearance/AppearancePreferencesProvider";
import { SceneryProvider } from "./features/scenery/SceneryProvider";
import { RootStack } from "./Stack";
import { appAtomRegistry } from "./state/atom-registry";
import { OverlayPortalHost } from "./components/OverlayPortal";
import { appBlurTargetRef } from "./lib/appBlurTarget";
import { useThemeColor } from "./lib/useThemeColor";

import "../global.css";

if (process.env.EXPO_PUBLIC_SHOWCASE === "1") {
  prepareNativeShowcaseCapture();
}

void SplashScreen.preventAutoHideAsync().catch(() => {
  // The native module can be unavailable in non-native test environments.
});

const appLinking = {
  prefixes: [Linking.createURL("/"), "t3code://", "t3code-dev://", "t3code-preview://"],
  // The Expo dev client launches the app via
  // <scheme>://expo-development-client/?url=<packager> — that URL addresses
  // the launcher, not app navigation. Without this filter it falls through
  // to the NotFound wildcard route on every dev launch.
  // expo-sharing uses a private lifecycle URL only to wake the app. The
  // persisted share inbox below owns navigation once the payload is durable.
  filter: (url: string) =>
    !url.includes("expo-development-client") && !url.includes("://expo-sharing"),
};

const Navigation = createStaticNavigation(RootStack);

function SplashScreenCoordinator() {
  const { isReady } = useAppearancePreferences();

  useEffect(() => {
    if (isReady) void SplashScreen.hide();
  }, [isReady]);

  return null;
}

export default function App() {
  const colorScheme = useColorScheme();
  const statusBarBg = useThemeColor("--color-status-bar");

  return (
    <RegistryContext.Provider value={appAtomRegistry}>
      <CloudAuthProvider>
        <AppearancePreferencesProvider>
          <SceneryProvider>
            <SplashScreenCoordinator />
            <GestureHandlerRootView className="flex-1">
              <KeyboardProvider statusBarTranslucent>
                <SafeAreaProvider>
                  <StatusBar
                    barStyle={colorScheme === "dark" ? "light-content" : "dark-content"}
                    backgroundColor={statusBarBg}
                    translucent
                  />
                  {/* The navigation theme drives the NATIVE header appearance: native-stack
                      forwards `dark` as the nav bar's overrideUserInterfaceStyle. Without
                      this, React Navigation defaults to its light theme and every native
                      header (glass buttons, title, materials) is forced light even when
                      the system is in dark mode. */}
                  {/* Blur target for Android dropdown backdrops — see appBlurTarget.ts. */}
                  <BlurTargetView ref={appBlurTargetRef} style={{ flex: 1 }}>
                    <IncomingShareProvider>
                      <LocalLiveActivitySync />
                      <Navigation
                        linking={appLinking}
                        theme={colorScheme === "dark" ? SCENERY_NAV_DARK : SCENERY_NAV_LIGHT}
                      />
                    </IncomingShareProvider>
                    <ConfirmDialogHost />
                    <WhatsNewHost />
                    <AppMenuHost />
                  </BlurTargetView>
                  {/* Anchored-menu overlays render here — in-window, so the
                      keyboard stays up while a dropdown is open. */}
                  <OverlayPortalHost />
                </SafeAreaProvider>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </SceneryProvider>
        </AppearancePreferencesProvider>
      </CloudAuthProvider>
    </RegistryContext.Provider>
  );
}
