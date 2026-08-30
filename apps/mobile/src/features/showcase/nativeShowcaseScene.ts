import { requireOptionalNativeModule } from "expo";

import { MOBILE_THEME_IDS, type MobileThemeId } from "../../lib/mobileTheme";

export const SHOWCASE_SCENES = ["threads", "thread", "terminal", "review", "environments"] as const;
export type ShowcaseScene = (typeof SHOWCASE_SCENES)[number];

export type ShowcaseOrientation = "portrait" | "landscape";

const SHOWCASE_PAIRING_URL_MAX_COUNT = 16;
const SHOWCASE_PAIRING_URL_MAX_LENGTH = 8_192;
const SHOWCASE_PAIRING_JSON_MAX_LENGTH =
  SHOWCASE_PAIRING_URL_MAX_COUNT * (SHOWCASE_PAIRING_URL_MAX_LENGTH + 8);
const SHOWCASE_PAIRING_ENCODED_PAYLOAD_MAX_LENGTH = SHOWCASE_PAIRING_JSON_MAX_LENGTH * 3;

interface NativeShowcaseControls {
  readonly getShowcasePairingUrl?: () => string | null;
  readonly getShowcaseScene?: () => string | null;
  readonly getShowcaseTheme?: () => string | null;
  readonly getShowcaseOrientation?: () => string | null;
  readonly applyShowcaseOrientation?: (orientation: ShowcaseOrientation) => Promise<void>;
  readonly getInterfaceOrientation?: () => Promise<string>;
  readonly prepareShowcaseCapture?: () => void;
  readonly markShowcaseReady?: (scene: ShowcaseScene) => void;
}

function nativeShowcaseControls(): NativeShowcaseControls | null {
  return requireOptionalNativeModule<NativeShowcaseControls>("T3NativeControls");
}

function normalizeShowcasePairingUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > SHOWCASE_PAIRING_URL_MAX_LENGTH) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= SHOWCASE_PAIRING_URL_MAX_LENGTH ? trimmed : null;
}

export function parseNativeShowcasePairingUrls(
  value: string | null | undefined,
): ReadonlyArray<string> {
  let raw = value?.trim();
  if (!raw || raw.length > SHOWCASE_PAIRING_ENCODED_PAYLOAD_MAX_LENGTH) return [];
  if (raw.startsWith("json-uri:")) {
    try {
      raw = decodeURIComponent(raw.slice("json-uri:".length));
    } catch {
      return [];
    }
  }
  if (raw.length > SHOWCASE_PAIRING_JSON_MAX_LENGTH) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const urls: string[] = [];
      for (const candidate of parsed) {
        const url = normalizeShowcasePairingUrl(candidate);
        if (url !== null) urls.push(url);
        if (urls.length >= SHOWCASE_PAIRING_URL_MAX_COUNT) break;
      }
      return urls;
    }
  } catch {
    // Older runners pass a single URL rather than a JSON array.
  }
  const url = normalizeShowcasePairingUrl(raw);
  return url === null ? [] : [url];
}

export function getNativeShowcasePairingUrls(): ReadonlyArray<string> {
  try {
    return parseNativeShowcasePairingUrls(nativeShowcaseControls()?.getShowcasePairingUrl?.());
  } catch {
    return [];
  }
}

export function getNativeShowcaseScene(): ShowcaseScene | null {
  try {
    const scene = nativeShowcaseControls()?.getShowcaseScene?.()?.trim();
    return SHOWCASE_SCENES.find((candidate) => candidate === scene) ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns null when the runner requested no palette, which leaves the stored
 * theme preference untouched. An unknown id also reads as null rather than
 * silently falling back, so a capture never claims to show a theme it does not.
 */
export function getNativeShowcaseTheme(): MobileThemeId | null {
  try {
    const theme = nativeShowcaseControls()?.getShowcaseTheme?.()?.trim();
    return MOBILE_THEME_IDS.find((candidate) => candidate === theme) ?? null;
  } catch {
    return null;
  }
}

export function prepareNativeShowcaseCapture(): void {
  try {
    nativeShowcaseControls()?.prepareShowcaseCapture?.();
  } catch {
    // The harness still works when a development build predates this helper.
  }
}

export function getNativeShowcaseOrientation(): ShowcaseOrientation | null {
  try {
    const orientation = nativeShowcaseControls()?.getShowcaseOrientation?.()?.trim();
    return orientation === "portrait" || orientation === "landscape" ? orientation : null;
  } catch {
    return null;
  }
}

export async function applyNativeShowcaseOrientation(
  orientation: ShowcaseOrientation,
): Promise<boolean> {
  const controls = nativeShowcaseControls();
  if (!controls?.applyShowcaseOrientation || !controls.getInterfaceOrientation) {
    // A development build that predates this helper keeps its default
    // orientation; report success so callers do not retry forever.
    return true;
  }
  try {
    await controls.applyShowcaseOrientation(orientation);
    // The geometry request settles asynchronously; confirm it took effect so
    // callers can retry attempts made before the scene was foreground-active.
    await new Promise((resolve) => setTimeout(resolve, 500));
    return (await controls.getInterfaceOrientation()) === orientation;
  } catch {
    return false;
  }
}

export function markNativeShowcaseReady(scene: ShowcaseScene): void {
  try {
    nativeShowcaseControls()?.markShowcaseReady?.(scene);
  } catch {
    // The readiness marker is capture-runner metadata, never app functionality.
  }
}
