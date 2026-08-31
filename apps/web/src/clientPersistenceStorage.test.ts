import {
  CLIENT_SETTINGS_LIST_MAX_LENGTH,
  CLIENT_SETTINGS_VALUE_MAX_LENGTH,
  DEFAULT_CLIENT_SETTINGS,
  ProviderInstanceId,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function getTestWindow(): Window & typeof globalThis {
  const localStorage = createLocalStorageStub();
  const testWindow = {
    localStorage,
  } as Window & typeof globalThis;
  vi.stubGlobal("window", testWindow);
  vi.stubGlobal("localStorage", localStorage);
  return testWindow;
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("clientPersistenceStorage", () => {
  it("observes this settings key and storage clears from other browser tabs", async () => {
    const testWindow = getTestWindow();
    const listeners: { storage?: (event: StorageEvent) => void } = {};
    const addEventListener = vi.fn((type: string, listener: (event: StorageEvent) => void) => {
      if (type === "storage") listeners.storage = listener;
    });
    const removeEventListener = vi.fn();
    Object.assign(testWindow, { addEventListener, removeEventListener });
    const { CLIENT_SETTINGS_STORAGE_KEY, subscribeBrowserClientSettings } =
      await import("./clientPersistenceStorage");
    const listener = vi.fn();

    const unsubscribe = subscribeBrowserClientSettings(listener);
    expect(listeners.storage).toBeDefined();
    listeners.storage?.({
      key: "unrelated",
      storageArea: testWindow.localStorage,
    } as StorageEvent);
    listeners.storage?.({
      key: CLIENT_SETTINGS_STORAGE_KEY,
      storageArea: createLocalStorageStub(),
    } as StorageEvent);
    expect(listener).not.toHaveBeenCalled();

    listeners.storage?.({
      key: CLIENT_SETTINGS_STORAGE_KEY,
      storageArea: testWindow.localStorage,
    } as StorageEvent);
    listeners.storage?.({ key: null, storageArea: null } as StorageEvent);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith("storage", listeners.storage);
  });

  it("persists client settings in browser storage", async () => {
    getTestWindow();
    const { readBrowserClientSettings, writeBrowserClientSettings } =
      await import("./clientPersistenceStorage");
    const settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      timestampFormat: "24-hour" as const,
    };

    writeBrowserClientSettings(settings);

    expect(readBrowserClientSettings()).toEqual(settings);
  });

  it("reports and preserves structured decode failures", async () => {
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem("t3code:client-settings:v1", "not-json");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { readBrowserClientSettings } = await import("./clientPersistenceStorage");

    expect(() => readBrowserClientSettings()).toThrow(
      expect.objectContaining({
        _tag: "LocalStorageOperationError",
        operation: "decode",
        storageKey: "t3code:client-settings:v1",
      }),
    );
    expect(consoleError).toHaveBeenCalledWith(
      "Could not read persisted client settings.",
      expect.objectContaining({
        _tag: "LocalStorageOperationError",
        operation: "decode",
        storageKey: "t3code:client-settings:v1",
        cause: expect.anything(),
      }),
    );
  });

  it("rejects oversized settings before decoding or writing", async () => {
    const testWindow = getTestWindow();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const {
      CLIENT_SETTINGS_STORAGE_KEY,
      CLIENT_SETTINGS_STORAGE_MAX_BYTES,
      readBrowserClientSettings,
      writeBrowserClientSettings,
    } = await import("./clientPersistenceStorage");
    testWindow.localStorage.setItem(
      CLIENT_SETTINGS_STORAGE_KEY,
      " ".repeat(CLIENT_SETTINGS_STORAGE_MAX_BYTES + 1),
    );

    expect(() => readBrowserClientSettings()).toThrow(
      expect.objectContaining({ operation: "read", storageKey: CLIENT_SETTINGS_STORAGE_KEY }),
    );

    const oversizedSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      favorites: Array.from({ length: CLIENT_SETTINGS_LIST_MAX_LENGTH }, () => ({
        provider: ProviderInstanceId.make("codex"),
        model: "x".repeat(CLIENT_SETTINGS_VALUE_MAX_LENGTH),
      })),
    };
    expect(() => writeBrowserClientSettings(oversizedSettings)).toThrow(
      expect.objectContaining({ operation: "write", storageKey: CLIENT_SETTINGS_STORAGE_KEY }),
    );
  });

  it("defaults word wrap on and discards obsolete wrapping preferences", async () => {
    const testWindow = getTestWindow();
    testWindow.localStorage.setItem(
      "t3code:client-settings:v1",
      JSON.stringify({
        chatWordWrap: false,
        diffWordWrap: false,
      }),
    );
    const { readBrowserClientSettings } = await import("./clientPersistenceStorage");
    const settings = readBrowserClientSettings();

    expect(settings).toEqual(
      expect.objectContaining({
        wordWrap: true,
      }),
    );
    expect(settings).not.toHaveProperty("chatWordWrap");
    expect(settings).not.toHaveProperty("diffWordWrap");
  });
});
