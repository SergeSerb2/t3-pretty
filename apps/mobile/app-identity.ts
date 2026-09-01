import type { T3CodeBuildFlavor } from "../../scripts/lib/public-config.ts";

export type MobileAppVariant = "development" | "preview" | "production";

export interface MobileAppIdentity {
  readonly scheme: string;
  readonly iosBundleIdentifier: string;
  readonly androidPackage: string;
}

export function resolveMobileAppVariant(value: string | undefined): MobileAppVariant {
  switch (value) {
    case "development":
    case "preview":
    case "production":
      return value;
    default:
      return "production";
  }
}

export function resolveProductionAndroidPackage(buildFlavor: T3CodeBuildFlavor): string {
  return buildFlavor === "internal"
    ? "com.sergeserbinenko.t3pretty"
    : "com.sergeserbinenko.t3pretty.app";
}

export function resolveMobileAppIdentity(
  appVariant: MobileAppVariant,
  buildFlavor: T3CodeBuildFlavor,
): MobileAppIdentity {
  switch (appVariant) {
    case "development":
      return {
        scheme: "t3code-dev",
        iosBundleIdentifier: "com.sergeserbinenko.t3pretty.dev",
        androidPackage: "com.sergeserbinenko.t3pretty.dev",
      };
    case "preview":
      return {
        scheme: "t3code-preview",
        iosBundleIdentifier: "com.sergeserbinenko.t3pretty.preview",
        androidPackage: "com.sergeserbinenko.t3pretty.preview",
      };
    case "production":
      return {
        scheme: "t3code",
        iosBundleIdentifier:
          buildFlavor === "internal"
            ? "com.sergeserbinenko.t3pretty"
            : "com.sergeserbinenko.t3pretty.public",
        androidPackage: resolveProductionAndroidPackage(buildFlavor),
      };
  }
}
