export type MobileStageLabel = "Beta" | "Dev" | "Nightly";

export function resolveMobileStageLabel(
  appVariant: unknown,
  buildFlavor?: unknown,
): MobileStageLabel | null {
  if (appVariant === "development") return "Dev";
  if (appVariant === "preview") return "Nightly";
  if (appVariant === "production" && buildFlavor === "public") return null;
  return "Beta";
}
