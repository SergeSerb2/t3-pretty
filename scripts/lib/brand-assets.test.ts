// @effect-diagnostics nodeBuiltinImport:off - Compares the committed in-app mark with its public copy.
import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import {
  BRAND_ASSET_PATHS,
  DEVELOPMENT_ICON_OVERRIDES,
  DEVELOPMENT_PUBLIC_ICON_OVERRIDES,
  resolvePrettyMarkCopies,
  resolveWebAssetBrandForChannel,
  resolveWebAssetBrandForPackageVersion,
  resolveWebIconOverrides,
} from "./brand-assets.ts";

describe("brand-assets", () => {
  it("maps production web assets into the server package", () => {
    expect(resolveWebIconOverrides("production", "dist/client")).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFaviconIco,
        targetRelativePath: "dist/client/favicon.ico",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon16Png,
        targetRelativePath: "dist/client/favicon-16x16.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebFavicon32Png,
        targetRelativePath: "dist/client/favicon-32x32.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
        targetRelativePath: "dist/client/apple-touch-icon.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.prettyMarkPng,
        targetRelativePath: "dist/client/t3-pretty-mark.png",
      },
    ]);
  });

  it("maps server build web assets to development icons", () => {
    expect(DEVELOPMENT_ICON_OVERRIDES[0]).toEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFaviconIco,
      targetRelativePath: "dist/client/favicon.ico",
    });
  });

  it("maps development web assets to the public splash and favicon files", () => {
    expect(DEVELOPMENT_PUBLIC_ICON_OVERRIDES).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFaviconIco,
        targetRelativePath: "apps/web/public/favicon.ico",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
        targetRelativePath: "apps/web/public/favicon-16x16.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
        targetRelativePath: "apps/web/public/favicon-32x32.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
        targetRelativePath: "apps/web/public/apple-touch-icon.png",
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.prettyMarkPng,
        targetRelativePath: "apps/web/public/t3-pretty-mark.png",
      },
    ]);
  });

  it("can target hosted web dist directly", () => {
    expect(resolveWebIconOverrides("production", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
      targetRelativePath: "apps/web/dist/apple-touch-icon.png",
    });
  });

  it("maps hosted nightly web assets to nightly icons", () => {
    expect(resolveWebIconOverrides("nightly", "apps/web/dist")).toContainEqual({
      sourceRelativePath: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
      targetRelativePath: "apps/web/dist/favicon.ico",
    });
  });

  it("maps hosted release channels to web asset brands", () => {
    expect(resolveWebAssetBrandForChannel("latest")).toBe("production");
    expect(resolveWebAssetBrandForChannel("nightly")).toBe("nightly");
  });

  it("maps package versions to web asset brands", () => {
    expect(resolveWebAssetBrandForPackageVersion("0.0.29")).toBe("production");
    expect(resolveWebAssetBrandForPackageVersion("0.0.29-nightly.20260723.882")).toBe("nightly");
  });

  it("keeps mobile composer sources while unifying desktop and web fork branding", () => {
    expect([
      BRAND_ASSET_PATHS.developmentIconComposerProject,
      BRAND_ASSET_PATHS.nightlyIconComposerProject,
      BRAND_ASSET_PATHS.productionIconComposerProject,
    ]).toEqual([
      "assets/dev/app-icon.icon",
      "assets/nightly/app-icon.icon",
      "assets/prod/app-icon.icon",
    ]);
    expect(BRAND_ASSET_PATHS.developmentDesktopIconPng).toBe(BRAND_ASSET_PATHS.prettyIconPng);
    expect(BRAND_ASSET_PATHS.nightlyMacIconPng).toBe(BRAND_ASSET_PATHS.prettyIconPng);
    expect(BRAND_ASSET_PATHS.productionMacIconPng).toBe(BRAND_ASSET_PATHS.prettyIconPng);
    expect(BRAND_ASSET_PATHS.nightlyWindowsIconIco).toBe(BRAND_ASSET_PATHS.prettyIconIco);
    expect(BRAND_ASSET_PATHS.productionWebFaviconIco).toBe(BRAND_ASSET_PATHS.prettyWebFaviconIco);
  });

  it("copies the generated mark into web public and the mobile package", () => {
    expect(resolvePrettyMarkCopies()).toEqual([
      {
        sourceRelativePath: BRAND_ASSET_PATHS.prettyMarkPng,
        targetRelativePath: BRAND_ASSET_PATHS.prettyMarkPublicPng,
      },
      {
        sourceRelativePath: BRAND_ASSET_PATHS.prettyMarkPng,
        targetRelativePath: BRAND_ASSET_PATHS.prettyMarkMobilePng,
      },
    ]);
  });

  it("keeps the in-app sidebar mark in public in sync with the pretty source", () => {
    const source = NodeFS.readFileSync(
      new URL(`../../${BRAND_ASSET_PATHS.prettyMarkPng}`, import.meta.url),
    );
    const published = NodeFS.readFileSync(
      new URL(`../../${BRAND_ASSET_PATHS.prettyMarkPublicPng}`, import.meta.url),
    );
    const mobile = NodeFS.readFileSync(
      new URL(`../../${BRAND_ASSET_PATHS.prettyMarkMobilePng}`, import.meta.url),
    );
    expect(published.equals(source)).toBe(true);
    expect(mobile.equals(source)).toBe(true);
  });

  it("keeps the macOS DMG installer branded as T3 Pretty", () => {
    for (const channel of ["latest", "nightly"] as const) {
      const svg = NodeFS.readFileSync(
        new URL(`../../apps/desktop/resources/dmg/dmg-background-${channel}.svg`, import.meta.url),
        "utf8",
      );
      expect(svg).toContain("T3 PRETTY");
      expect(svg).toContain("Drag T3 Pretty to Applications");
      expect(svg).not.toContain("T3 CODE");
      expect(svg).not.toContain("Drag T3 Code");
    }
  });
});
