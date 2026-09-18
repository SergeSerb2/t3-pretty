/**
 * Tesla's passenger browser is Chromium on a large landscape touchscreen.
 * It looks like a desktop viewport, so phone breakpoints never fire, but the
 * only input is a finger — and some firmware still reports a fine pointer.
 *
 * Detect that browser, let Auto/On/Off override it, and stamp `data-tesla-touch`
 * on <html> so CSS and overlay navigation can follow.
 */
import * as Schema from "effect/Schema";
import { useEffect, useSyncExternalStore } from "react";

import { getLocalStorageItem, useLocalStorage } from "./hooks/useLocalStorage";

export const TESLA_TOUCH_STORAGE_KEY = "t3code:tesla-touch";
export const TESLA_TOUCH_QUERY_PARAM = "tesla-touch";
export const DEFAULT_TESLA_TOUCH_PREFERENCE = "auto";

export const TeslaTouchPreference = Schema.Literals(["auto", "on", "off"]);
export type TeslaTouchPreference = typeof TeslaTouchPreference.Type;

export const TESLA_TOUCH_PREFERENCE_LABELS: Record<TeslaTouchPreference, string> = {
  auto: "Auto",
  on: "On",
  off: "Off",
};

const TESLA_FIRMWARE_UA_RE = /(?:^|[\s;])Tesla\/[\w.+-]+/i;
const TESLA_QT_UA_RE = /QtCarBrowser/i;
const TESLA_AUTO_UA_RE = /\bTESLA_AUTO_/i;

const teslaTouchListeners = new Set<() => void>();
let teslaTouchEnabled = false;

function emitTeslaTouch(): void {
  for (const listener of teslaTouchListeners) {
    listener();
  }
}

/**
 * Tesla in-car Chromium puts a `Tesla/<firmware>` token on the UA. Older cars
 * used QtCarBrowser; some 2025+ builds also append `TESLA_AUTO_…`.
 */
export function isTeslaCarBrowserUserAgent(userAgent: string): boolean {
  if (userAgent.length === 0) return false;
  return (
    TESLA_FIRMWARE_UA_RE.test(userAgent) ||
    TESLA_QT_UA_RE.test(userAgent) ||
    TESLA_AUTO_UA_RE.test(userAgent)
  );
}

export function parseTeslaTouchQueryParam(search: string): boolean | null {
  const query = search.startsWith("?") ? search.slice(1) : search;
  const raw = new URLSearchParams(query).get(TESLA_TOUCH_QUERY_PARAM);
  if (raw === null) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "1" || normalized === "on" || normalized === "true") return true;
  if (normalized === "0" || normalized === "off" || normalized === "false") return false;
  return null;
}

export function resolveTeslaTouchUi(input: {
  readonly preference: TeslaTouchPreference;
  readonly search: string;
  readonly userAgent: string;
}): boolean {
  const query = parseTeslaTouchQueryParam(input.search);
  if (query !== null) return query;
  if (input.preference === "on") return true;
  if (input.preference === "off") return false;
  return isTeslaCarBrowserUserAgent(input.userAgent);
}

export function readTeslaTouchPreference(): TeslaTouchPreference {
  try {
    return getLocalStorageItem(TESLA_TOUCH_STORAGE_KEY, TeslaTouchPreference) ?? "auto";
  } catch {
    return "auto";
  }
}

export function applyTeslaTouchDocumentState(
  enabled: boolean,
  root: HTMLElement = document.documentElement,
): void {
  const next = Boolean(enabled);
  if (next) {
    root.dataset.teslaTouch = "true";
  } else {
    delete root.dataset.teslaTouch;
  }
  if (teslaTouchEnabled === next) return;
  teslaTouchEnabled = next;
  emitTeslaTouch();
}

export function syncTeslaTouchUi(input?: {
  readonly preference?: TeslaTouchPreference;
  readonly root?: HTMLElement;
  readonly search?: string;
  readonly userAgent?: string;
}): boolean {
  const enabled = resolveTeslaTouchUi({
    preference: input?.preference ?? readTeslaTouchPreference(),
    search: input?.search ?? (typeof window === "undefined" ? "" : window.location.search),
    userAgent: input?.userAgent ?? (typeof navigator === "undefined" ? "" : navigator.userAgent),
  });
  if (typeof document !== "undefined") {
    applyTeslaTouchDocumentState(enabled, input?.root ?? document.documentElement);
  } else {
    teslaTouchEnabled = enabled;
  }
  return enabled;
}

export function useTeslaTouchPreference(): [
  TeslaTouchPreference,
  (value: TeslaTouchPreference) => void,
] {
  return useLocalStorage(
    TESLA_TOUCH_STORAGE_KEY,
    DEFAULT_TESLA_TOUCH_PREFERENCE,
    TeslaTouchPreference,
  );
}

export function useTeslaTouchUi(): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      teslaTouchListeners.add(onStoreChange);
      return () => {
        teslaTouchListeners.delete(onStoreChange);
      };
    },
    () => teslaTouchEnabled,
    () => false,
  );
}

/** Keeps `data-tesla-touch` in sync when Settings or the palette change Auto/On/Off. */
export function useTeslaTouchDocumentSync(): void {
  const [preference] = useTeslaTouchPreference();
  useEffect(() => {
    syncTeslaTouchUi({ preference });
  }, [preference]);
}
