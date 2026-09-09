import { ClientSettingsSchema, type ClientSettings } from "@t3tools/contracts";

import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

export function readBrowserClientSettings(): ClientSettings | null {
  if (!hasWindow()) {
    return null;
  }

  return getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema);
}

export function writeBrowserClientSettings(settings: ClientSettings): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(
    CLIENT_SETTINGS_STORAGE_KEY,
    settings,
    ClientSettingsSchema,
    CLIENT_SETTINGS_STORAGE_OPTIONS,
  );
}

/**
 * Observe client-settings writes made by another browser tab. Desktop owns
 * persistence in the main process and does not use browser storage events.
 */
export function subscribeBrowserClientSettings(listener: () => void): () => void {
  if (
    !hasWindow() ||
    window.desktopBridge ||
    typeof window.addEventListener !== "function" ||
    typeof window.removeEventListener !== "function"
  ) {
    return NOOP_UNSUBSCRIBE;
  }

  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return NOOP_UNSUBSCRIBE;
  }

  const onStorage = (event: StorageEvent) => {
    if (
      (event.key === CLIENT_SETTINGS_STORAGE_KEY || event.key === null) &&
      (event.storageArea === null || event.storageArea === storage)
    ) {
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
