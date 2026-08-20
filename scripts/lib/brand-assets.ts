export const BRAND_ASSET_PATHS = {
  prettyIconPng: "assets/pretty/t3-pretty-1024.png",
  prettyIosIconPng: "assets/pretty/t3-pretty-ios-1024.png",
  prettyIconIcns: "assets/pretty/t3-pretty.icns",
  prettyIconIco: "assets/pretty/t3-pretty.ico",
  prettyWebFaviconIco: "assets/pretty/t3-pretty.ico",
  prettyWebFavicon16Png: "assets/pretty/t3-pretty-favicon-16x16.png",
  prettyWebFavicon32Png: "assets/pretty/t3-pretty-favicon-32x32.png",
  prettyWebAppleTouchIconPng: "assets/pretty/t3-pretty-apple-touch-180.png",
  prettyMarkPng: "assets/pretty/t3-pretty-mark.png",
  prettyMarkPublicPng: "apps/web/public/t3-pretty-mark.png",
  prettyMarkMobilePng: "apps/mobile/assets/t3-pretty-mark.png",

  developmentIconComposerProject: "assets/dev/app-icon.icon",
  developmentIosIconPng: "assets/dev/blueprint-ios-1024.png",
  developmentUniversalIconPng: "assets/dev/blueprint-universal-1024.png",

  productionIconComposerProject: "assets/prod/app-icon.icon",
  productionIosIconPng: "assets/pretty/t3-pretty-ios-1024.png",
  productionMacIconPng: "assets/pretty/t3-pretty-1024.png",
  productionLinuxIconPng: "assets/pretty/t3-pretty-1024.png",
  productionWindowsIconIco: "assets/pretty/t3-pretty.ico",
  productionWebFaviconIco: "assets/pretty/t3-pretty.ico",
  productionWebFavicon16Png: "assets/pretty/t3-pretty-favicon-16x16.png",
  productionWebFavicon32Png: "assets/pretty/t3-pretty-favicon-32x32.png",
  productionWebAppleTouchIconPng: "assets/pretty/t3-pretty-apple-touch-180.png",

  nightlyIconComposerProject: "assets/nightly/app-icon.icon",
  nightlyIosIconPng: "assets/pretty/t3-pretty-ios-1024.png",
  nightlyMacIconPng: "assets/pretty/t3-pretty-1024.png",
  nightlyLinuxIconPng: "assets/pretty/t3-pretty-1024.png",
  nightlyWindowsIconIco: "assets/pretty/t3-pretty.ico",
  nightlyWebFaviconIco: "assets/pretty/t3-pretty.ico",
  nightlyWebFavicon16Png: "assets/pretty/t3-pretty-favicon-16x16.png",
  nightlyWebFavicon32Png: "assets/pretty/t3-pretty-favicon-32x32.png",
  nightlyWebAppleTouchIconPng: "assets/pretty/t3-pretty-apple-touch-180.png",

  developmentDesktopIconPng: "assets/pretty/t3-pretty-1024.png",
  developmentWindowsIconIco: "assets/pretty/t3-pretty.ico",
  developmentWebFaviconIco: "assets/pretty/t3-pretty.ico",
  developmentWebFavicon16Png: "assets/pretty/t3-pretty-favicon-16x16.png",
  developmentWebFavicon32Png: "assets/pretty/t3-pretty-favicon-32x32.png",
  developmentWebAppleTouchIconPng: "assets/pretty/t3-pretty-apple-touch-180.png",
} as const;

export type WebAssetBrand = "development" | "nightly" | "production";

export const WEB_ASSET_CHANNELS = ["latest", "nightly"] as const;

export type WebAssetChannel = (typeof WEB_ASSET_CHANNELS)[number];

export function resolveWebAssetBrandForChannel(channel: WebAssetChannel): WebAssetBrand {
  return channel === "nightly" ? "nightly" : "production";
}

export function resolveWebAssetBrandForPackageVersion(version: string): WebAssetBrand {
  return version.includes("-nightly.") ? "nightly" : "production";
}

export interface IconOverride {
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}

const WEB_ICON_TARGET_FILENAMES = {
  faviconIco: "favicon.ico",
  favicon16Png: "favicon-16x16.png",
  favicon32Png: "favicon-32x32.png",
  appleTouchIconPng: "apple-touch-icon.png",
  markPng: "t3-pretty-mark.png",
} as const;

const WEB_ICON_SOURCE_PATHS_BY_BRAND = {
  development: {
    faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
    markPng: BRAND_ASSET_PATHS.prettyMarkPng,
  },
  nightly: {
    faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
    markPng: BRAND_ASSET_PATHS.prettyMarkPng,
  },
  production: {
    faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    favicon16Png: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    favicon32Png: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    appleTouchIconPng: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
    markPng: BRAND_ASSET_PATHS.prettyMarkPng,
  },
} as const satisfies Record<WebAssetBrand, Record<keyof typeof WEB_ICON_TARGET_FILENAMES, string>>;

export function resolveWebIconOverrides(
  brand: WebAssetBrand,
  targetDirectory: string,
): ReadonlyArray<IconOverride> {
  const sourcePaths = WEB_ICON_SOURCE_PATHS_BY_BRAND[brand];
  return [
    {
      sourceRelativePath: sourcePaths.faviconIco,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.faviconIco}`,
    },
    {
      sourceRelativePath: sourcePaths.favicon16Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon16Png}`,
    },
    {
      sourceRelativePath: sourcePaths.favicon32Png,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.favicon32Png}`,
    },
    {
      sourceRelativePath: sourcePaths.appleTouchIconPng,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.appleTouchIconPng}`,
    },
    {
      sourceRelativePath: sourcePaths.markPng,
      targetRelativePath: `${targetDirectory}/${WEB_ICON_TARGET_FILENAMES.markPng}`,
    },
  ];
}

export const DEVELOPMENT_ICON_OVERRIDES = resolveWebIconOverrides("development", "dist/client");

export const DEVELOPMENT_PUBLIC_ICON_OVERRIDES = resolveWebIconOverrides(
  "development",
  "apps/web/public",
);
