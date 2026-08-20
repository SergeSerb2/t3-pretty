import type { ExpoConfig } from "expo/config";

import { BRAND_ASSET_PATHS } from "../../scripts/lib/brand-assets.ts";
import { loadRepoEnv, readReleaseTrainVersion } from "../../scripts/lib/public-config.ts";

type AppVariant = "development" | "preview" | "production";

const repoEnv = loadRepoEnv();
Object.assign(process.env, repoEnv);

const APP_VARIANT = resolveAppVariant(repoEnv.APP_VARIANT);
const isIosPersonalTeamBuild = repoEnv.T3CODE_IOS_PERSONAL_TEAM === "1";

const personalTeamBundleIdentifier = repoEnv.T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID?.trim();
const IOS_BUNDLE_IDENTIFIER_PATTERN = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

const fromRepoRoot = (relativePath: string) => `../../${relativePath}`;

if (
  isIosPersonalTeamBuild &&
  (!personalTeamBundleIdentifier ||
    !IOS_BUNDLE_IDENTIFIER_PATTERN.test(personalTeamBundleIdentifier))
) {
  throw new Error(
    "T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID must be a reverse-DNS identifier such as com.example.t3code when T3CODE_IOS_PERSONAL_TEAM=1.",
  );
}

const DEVELOPMENT_ASSETS = {
  appIcon: fromRepoRoot(BRAND_ASSET_PATHS.developmentIosIconPng),
  iosIcon: fromRepoRoot(BRAND_ASSET_PATHS.developmentIconComposerProject),
  splashIcon: fromRepoRoot(BRAND_ASSET_PATHS.developmentIosIconPng),
  androidAdaptiveForeground: fromRepoRoot(BRAND_ASSET_PATHS.developmentUniversalIconPng),
  androidAdaptiveBackgroundColor: "#00639B",
  androidMonochromeIcon: "./assets/android-icon-mark.png",
  androidNotificationIcon: "./assets/android-notification-icon.png",
  androidNotificationColor: "#00639B",
} as const;

const PREVIEW_ASSETS = {
  appIcon: fromRepoRoot(BRAND_ASSET_PATHS.nightlyIosIconPng),
  // The T3 Pretty icon ships as a plain PNG, not an Icon Composer project, so
  // point ios.icon at the PNG or the upstream composer art would win on iOS.
  iosIcon: fromRepoRoot(BRAND_ASSET_PATHS.prettyIosIconPng),
  splashIcon: fromRepoRoot(BRAND_ASSET_PATHS.nightlyIosIconPng),
  androidAdaptiveForeground: fromRepoRoot(BRAND_ASSET_PATHS.nightlyLinuxIconPng),
  androidAdaptiveBackgroundColor: "#DFEFE3",
  androidMonochromeIcon: "./assets/android-icon-mark.png",
  androidNotificationIcon: "./assets/android-notification-icon.png",
  androidNotificationColor: "#7EAA8C",
} as const;

const RELEASE_ASSETS = {
  appIcon: fromRepoRoot(BRAND_ASSET_PATHS.productionIosIconPng),
  iosIcon: fromRepoRoot(BRAND_ASSET_PATHS.prettyIosIconPng),
  splashIcon: fromRepoRoot(BRAND_ASSET_PATHS.productionIosIconPng),
  androidAdaptiveForeground: "./assets/android-icon-mark.png",
  androidAdaptiveBackgroundColor: "#DFEFE3",
  androidMonochromeIcon: "./assets/android-icon-mark.png",
  androidNotificationIcon: "./assets/android-notification-icon.png",
  androidNotificationColor: "#7EAA8C",
} as const;

// The fork's Clerk instance hosts the passkey relying party + universal links.
// Derive it from the configured publishable key (pk_live_<base64 domain>$) so
// swapping Clerk instances via env cannot leave stale associated domains.
const FORK_RELYING_PARTY = "clerk.sergeserbinenko.com";

function resolveRelyingParty(publishableKey: string | undefined): string {
  if (!publishableKey) return FORK_RELYING_PARTY;
  const encoded = publishableKey.replace(/^pk_(?:live|test)_/, "");
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    return decoded.endsWith("$") ? decoded.slice(0, -1) : FORK_RELYING_PARTY;
  } catch {
    return FORK_RELYING_PARTY;
  }
}

const relyingParty = resolveRelyingParty(repoEnv.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY);

// Schemes stay `t3code*` on purpose: pairing QR codes and hosted pair links
// encode the upstream scheme, and Surge Connect keeps technical identifiers
// upstream-compatible (see docs/internals/t3-connect.md).
const VARIANT_CONFIG = {
  development: {
    appName: "T3 Pretty Dev",
    scheme: "t3code-dev",
    iosBundleIdentifier: "com.sergeserbinenko.t3pretty.dev",
    androidPackage: "com.sergeserbinenko.t3pretty.dev",
    relyingParty,
    assets: DEVELOPMENT_ASSETS,
  },
  preview: {
    appName: "T3 Pretty Preview",
    scheme: "t3code-preview",
    iosBundleIdentifier: "com.sergeserbinenko.t3pretty.preview",
    androidPackage: "com.sergeserbinenko.t3pretty.preview",
    relyingParty,
    assets: PREVIEW_ASSETS,
  },
  production: {
    appName: "T3 Pretty",
    scheme: "t3code",
    iosBundleIdentifier: "com.sergeserbinenko.t3pretty",
    androidPackage: "com.sergeserbinenko.t3pretty",
    relyingParty,
    assets: RELEASE_ASSETS,
  },
} as const;

function resolveAppVariant(value: string | undefined): AppVariant {
  switch (value) {
    case "development":
    case "preview":
    case "production":
      return value;
    default:
      return "production";
  }
}

const variant = VARIANT_CONFIG[APP_VARIANT];
const iosBundleIdentifier = isIosPersonalTeamBuild
  ? personalTeamBundleIdentifier!
  : variant.iosBundleIdentifier;

const dmSansFonts = {
  regular: "@expo-google-fonts/dm-sans/400Regular/DMSans_400Regular.ttf",
  medium: "@expo-google-fonts/dm-sans/500Medium/DMSans_500Medium.ttf",
  bold: "@expo-google-fonts/dm-sans/700Bold/DMSans_700Bold.ttf",
} as const;

const widgetsPlugin: NonNullable<ExpoConfig["plugins"]>[number] = [
  "expo-widgets",
  {
    bundleIdentifier: `${iosBundleIdentifier}.widgets`,
    groupIdentifier: `group.${iosBundleIdentifier}`,
    enablePushNotifications: true,
    // Agent activity can update many times an hour; without the
    // frequent-updates entitlement iOS throttles the update budget sooner.
    frequentUpdates: true,
    widgets: [
      {
        name: "AgentActivity",
        displayName: "Agent Activity",
        description: "Shows the current state of active T3 Pretty agents.",
        supportedFamilies: ["systemSmall", "systemMedium", "accessoryRectangular"],
      },
    ],
  },
];

const shareExtensionEnabled = !isIosPersonalTeamBuild && repoEnv.T3CODE_IOS_SHARE_EXTENSION !== "0";

const sharingPlugin: NonNullable<ExpoConfig["plugins"]>[number] = [
  "expo-sharing",
  {
    ios: {
      // Personal Teams cannot sign App Groups or extension targets. Keep the
      // reduced-capability local build usable while release builds expose the
      // real system share target. T3CODE_IOS_SHARE_EXTENSION=0 disables the
      // extension even on full teams — the `.share` App ID needs its App
      // Groups container ticked on the Developer Portal first (headless
      // re-provisioning cannot attach it), which is a one-time manual step.
      enabled: shareExtensionEnabled,
      extensionBundleIdentifier: `${iosBundleIdentifier}.share`,
      appGroupId: `group.${iosBundleIdentifier}`,
      activationRule: {
        supportsText: true,
        supportsWebUrlWithMaxCount: 1,
        supportsImageWithMaxCount: 8,
      },
    },
    android: {
      enabled: true,
      singleShareMimeTypes: ["text/plain", "image/*"],
      multipleShareMimeTypes: ["image/*"],
    },
  },
];

// These aliases match the fonts' PostScript names on iOS. Register the same
// names on Android so React Native and the native composer use one set of
// family names without waiting for runtime font loading.

// Fork-owned OTA endpoint. Left unset, updates are disabled entirely: the
// upstream EAS project shares runtime fingerprints with fork binaries, so
// keeping upstream's URL would let upstream OTA bundles replace fork JS.
const mobileUpdateUrl = repoEnv.T3CODE_MOBILE_UPDATE_URL?.trim();
const easProjectId = repoEnv.T3CODE_MOBILE_EAS_PROJECT_ID?.trim();
const expoOwner = repoEnv.T3CODE_MOBILE_EXPO_OWNER?.trim();
const appleTeamId = repoEnv.T3CODE_APPLE_TEAM_ID?.trim();

// The mobile version tracks the T3 Pretty release train (apps/web/package.json,
// rewritten by scripts/update-release-package-versions.ts during releases) so
// the in-app What's New changelog can key entries by release. iOS rejects
// prerelease suffixes in CFBundleShortVersionString, so only the numeric
// prefix survives ("0.0.34-nightly.x" → "0.0.34").
function resolveMobileAppVersion(): string {
  const raw = repoEnv.T3CODE_MOBILE_APP_VERSION?.trim() || readReleaseTrainVersion() || "";
  return /^(\d+\.\d+\.\d+)/.exec(raw)?.[1] ?? "0.0.33";
}

const config: ExpoConfig = {
  name: variant.appName,
  slug: repoEnv.T3CODE_MOBILE_EXPO_SLUG?.trim() || "t3-pretty",
  platforms: ["ios", "android"],
  scheme: variant.scheme,
  version: resolveMobileAppVersion(),
  runtimeVersion: {
    // Fingerprint (not appVersion) so an OTA only reaches binaries whose native
    // project — native deps, config plugins, AND patches/ — matches the update.
    // With appVersion, every 0.1.0 build shares a runtime version, so a JS update
    // could land on a binary missing the native changes it needs and crash.
    policy: process.env.MOBILE_VERSION_POLICY ?? "fingerprint",
  },
  orientation: "portrait",
  icon: variant.assets.appIcon,
  userInterfaceStyle: "automatic",
  updates: mobileUpdateUrl
    ? {
        enabled: true,
        url: mobileUpdateUrl,
        // EAS Build injects its profile channel, but local Xcode Release builds
        // do not. Embed the variant channel so those binaries send a valid
        // expo-channel-name header instead of crashing on the update request.
        requestHeaders: {
          "expo-channel-name": APP_VARIANT,
        },
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
      }
    : { enabled: false },
  ios: {
    icon: variant.assets.iosIcon,
    supportsTablet: true,
    // Multitasking-capable iPad apps cannot rotate programmatically, so the
    // showcase capture build requires full screen (see infoPlist below).
    requireFullScreen: process.env.T3_SHOWCASE_CAPTURE_BUILD === "1",
    bundleIdentifier: iosBundleIdentifier,
    // Pin code signing via T3CODE_IOS_APPLE_TEAM_ID so non-interactive
    // `expo run:ios` does not fall back to a personal team (which cannot sign
    // app groups, Sign in with Apple, or push notification entitlements).
    // Unset, Xcode selects whichever team the local account provides.
    ...(appleTeamId ? { appleTeamId } : {}),
    associatedDomains: [
      `applinks:${variant.relyingParty}`,
      `webcredentials:${variant.relyingParty}`,
    ],
    infoPlist: {
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: true,
      },
      NSLocalNetworkUsageDescription:
        "Allow T3 Pretty to connect to T3 Code servers on your local network or tailnet.",
      ITSAppUsesNonExemptEncryption: false,
      // The App Store screenshot harness rotates the iPad interface from
      // inside the app (CI denies osascript the Accessibility access that
      // Simulator menu scripting needs), and iPadOS ignores programmatic
      // orientation requests for multitasking-capable apps — so the capture
      // build opts out of multitasking and declares landscape support.
      ...(process.env.T3_SHOWCASE_CAPTURE_BUILD === "1"
        ? {
            "UISupportedInterfaceOrientations~ipad": [
              "UIInterfaceOrientationPortrait",
              "UIInterfaceOrientationPortraitUpsideDown",
              "UIInterfaceOrientationLandscapeLeft",
              "UIInterfaceOrientationLandscapeRight",
            ],
          }
        : {}),
    },
  },
  android: {
    icon: variant.assets.appIcon,
    package: variant.androidPackage,
    adaptiveIcon: {
      backgroundColor: variant.assets.androidAdaptiveBackgroundColor,
      foregroundImage: variant.assets.androidAdaptiveForeground,
      monochromeImage: variant.assets.androidMonochromeIcon,
    },
    // Opts into OnBackInvokedCallback-based back dispatch (Android 13+).
    // JS back handling survives it via react-native's Android 16 shim plus
    // withAndroidPredictiveBackCompat on Android 13-15.
    predictiveBackGestureEnabled: true,
  },
  web: {
    favicon: variant.assets.appIcon,
  },
  plugins: [
    "expo-asset",
    [
      "expo-font",
      {
        ios: {
          fonts: [dmSansFonts.regular, dmSansFonts.medium, dmSansFonts.bold],
        },
        android: {
          fonts: [
            {
              fontFamily: "DMSans-Regular",
              fontDefinitions: [{ path: dmSansFonts.regular, weight: 400 }],
            },
            {
              fontFamily: "DMSans-Medium",
              fontDefinitions: [{ path: dmSansFonts.medium, weight: 500 }],
            },
            {
              fontFamily: "DMSans-Bold",
              fontDefinitions: [{ path: dmSansFonts.bold, weight: 700 }],
            },
          ],
        },
      },
    ],
    "expo-secure-store",
    "expo-sqlite",
    ...(shareExtensionEnabled
      ? ["./plugins/withShareExtensionDisplayName.cjs", sharingPlugin]
      : [sharingPlugin]),
    [
      "expo-notifications",
      {
        icon: variant.assets.androidNotificationIcon,
        color: variant.assets.androidNotificationColor,
        mode: APP_VARIANT === "development" ? "development" : "production",
      },
    ],
    // appleSignIn must be gated here: withoutIosPersonalTeamCapabilities.cjs runs before
    // plugins earlier in this array, so it cannot strip the entitlement Clerk would add.
    ["@clerk/expo", { theme: "./clerk-theme.json", appleSignIn: !isIosPersonalTeamBuild }],
    "expo-web-browser",
    [
      "expo-quick-actions",
      {
        // Adaptive launcher-shortcut icon; referenced by resource name from
        // the shortcut items set in src/features/shortcuts.
        androidIcons: {
          shortcut_icon: {
            foregroundImage: variant.assets.androidAdaptiveForeground,
            backgroundColor: variant.assets.androidAdaptiveBackgroundColor,
          },
        },
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission: "Allow T3 Pretty to access your camera so you can scan pairing QR codes.",
        microphonePermission: false,
        barcodeScannerEnabled: true,
        recordAudioAndroid: false,
      },
    ],
    ["expo-image-picker", { photosPermission: false, microphonePermission: false }],
    [
      "expo-splash-screen",
      {
        image: variant.assets.splashIcon,
        resizeMode: "contain",
        // World Scenery screen tokens — keep in step with global.css.
        backgroundColor: "#f4f6f4",
        imageWidth: 220,
        dark: {
          image: variant.assets.splashIcon,
          backgroundColor: "#0e1110",
        },
      },
    ],
    [
      "expo-build-properties",
      {
        ios: {
          deploymentTarget: "18.0",
          // AppCheckCore 11.3+ includes Swift and needs module maps for these Objective-C dependencies.
          extraPods: [
            { name: "GoogleUtilities", modular_headers: true },
            { name: "RecaptchaInterop", modular_headers: true },
          ],
        },
      },
    ],
    "./plugins/withIosCocoaPodsUuidCache.cjs",
    "./plugins/withIosPodMinDeploymentTarget.cjs",
    // Must be listed BEFORE expo-widgets: same-type mods run last-registered-
    // first, so registering earlier makes this plugin's mods run AFTER
    // expo-widgets' — its dangerous mod wipes ios/ExpoWidgetsTarget/ (which
    // would delete the asset catalog) and its xcodeproj mod creates the widget
    // target (which must exist before the compile phase can be attached).
    ...(!isIosPersonalTeamBuild ? ["./plugins/withWidgetLogoAsset.cjs", widgetsPlugin] : []),
    "./plugins/withIosSceneLifecycle.cjs",
    "./plugins/withAndroidCleartextTraffic.cjs",
    "./plugins/withAndroidGradleHeap.cjs",
    "./plugins/withAndroidModernPopupMenu.cjs",
    "./plugins/withAndroidModernAlertDialog.cjs",
    "./plugins/withAndroidPredictiveBackCompat.cjs",
    "./plugins/withAndroidTabletOrientation.cjs",
    ...(isIosPersonalTeamBuild ? ["./plugins/withoutIosPersonalTeamCapabilities.cjs"] : []),
  ],
  extra: {
    appVariant: APP_VARIANT,
    iosPersonalTeamBuild: isIosPersonalTeamBuild,
    relay: {
      url: repoEnv.T3CODE_RELAY_URL ?? null,
    },
    clerk: {
      publishableKey: repoEnv.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? null,
      jwtTemplate: repoEnv.EXPO_PUBLIC_CLERK_JWT_TEMPLATE ?? null,
    },
    // Native Google sign-in credentials. @clerk/expo reads these from `extra`
    // under their exact env-var names (not nested), and its config plugin reads
    // the iOS URL scheme at prebuild to register it in Info.plist.
    // Unset values must be omitted (not null): the public manifest serializes
    // null to {}, which is truthy and would defeat Clerk's fallback checks.
    EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID: repoEnv.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID,
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID: repoEnv.EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID,
    EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID: repoEnv.EXPO_PUBLIC_CLERK_GOOGLE_ANDROID_CLIENT_ID,
    EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME: repoEnv.EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME,
    observability: {
      tracesUrl: repoEnv.EXPO_PUBLIC_OTLP_TRACES_URL ?? "https://api.axiom.co/v1/traces",
      tracesDataset: repoEnv.EXPO_PUBLIC_OTLP_TRACES_DATASET ?? null,
      tracesToken: repoEnv.EXPO_PUBLIC_OTLP_TRACES_TOKEN ?? null,
    },
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
  ...(expoOwner ? { owner: expoOwner } : {}),
};

export default config;
