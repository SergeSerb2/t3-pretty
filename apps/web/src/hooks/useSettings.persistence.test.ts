import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function installPersistenceBridge(input: {
  readonly getClientSettings: () => Promise<ClientSettings | null>;
  readonly setClientSettings: (settings: ClientSettings) => Promise<void>;
}) {
  vi.stubGlobal("window", {
    desktopBridge: {
      getClientSettings: input.getClientSettings,
      setClientSettings: input.setClientSettings,
    },
  });
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("client settings persistence", () => {
  it("merges edits made during hydration over every persisted field", async () => {
    const read = deferred<ClientSettings | null>();
    const setClientSettings = vi.fn(async () => undefined);
    installPersistenceBridge({
      getClientSettings: () => read.promise,
      setClientSettings,
    });
    const settings = await import("./useSettings");

    const hydration = settings.ensureClientSettingsHydrated();
    settings.__persistClientSettingsPatchForTests({ timestampFormat: "24-hour" });
    read.resolve({
      ...DEFAULT_CLIENT_SETTINGS,
      browserDefaultZoomFactor: 1.5,
      timestampFormat: "12-hour",
    });

    await hydration;
    await settings.__waitForClientSettingsPersistenceForTests();

    expect(settings.getClientSettings()).toEqual(
      expect.objectContaining({
        browserDefaultZoomFactor: 1.5,
        timestampFormat: "24-hour",
      }),
    );
    expect(setClientSettings).toHaveBeenCalledOnce();
    expect(setClientSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        browserDefaultZoomFactor: 1.5,
        timestampFormat: "24-hour",
      }),
    );
  });

  it("serializes writes, skips superseded documents, and continues after failure", async () => {
    const firstWrite = deferred<void>();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const setClientSettings = vi
      .fn<(settings: ClientSettings) => Promise<void>>()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue(undefined);
    installPersistenceBridge({
      getClientSettings: async () => DEFAULT_CLIENT_SETTINGS,
      setClientSettings,
    });
    const settings = await import("./useSettings");
    settings.__setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);

    settings.__persistClientSettingsPatchForTests({ fontSizeCode: 14 });
    settings.__persistClientSettingsPatchForTests({ fontSizeCode: 15 });
    settings.__persistClientSettingsPatchForTests({ fontSizeCode: 16 });
    firstWrite.reject(new Error("disk unavailable"));
    await settings.__waitForClientSettingsPersistenceForTests();

    expect(setClientSettings).toHaveBeenCalledTimes(2);
    expect(setClientSettings.mock.calls[0]?.[0].fontSizeCode).toBe(14);
    expect(setClientSettings.mock.calls[1]?.[0].fontSizeCode).toBe(16);
    expect(consoleError).toHaveBeenCalledWith(
      "[CLIENT_SETTINGS] persist failed",
      expect.objectContaining({ operation: "persist" }),
    );
  });
});
