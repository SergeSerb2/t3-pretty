import * as Schema from "effect/Schema";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createStorage(overrides: Partial<Storage> = {}): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
    ...overrides,
  };
}

async function loadWithStorage(storage: Storage) {
  vi.stubGlobal("window", { localStorage: storage });
  vi.stubGlobal("localStorage", storage);
  return import("./useLocalStorage");
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("local storage errors", () => {
  it("falls back to memory when the localStorage property is blocked", async () => {
    const blockedWindow = Object.defineProperty({}, "localStorage", {
      get: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    vi.stubGlobal("window", blockedWindow);
    const { getLocalStorageItem, setLocalStorageItem } = await import("./useLocalStorage");

    setLocalStorageItem("memory-key", "value", Schema.String);

    expect(getLocalStorageItem("memory-key", Schema.String)).toBe("value");
  });

  it("preserves read failure context", async () => {
    const cause = new Error("storage unavailable");
    const { getLocalStorageItem, LocalStorageOperationError } = await loadWithStorage(
      createStorage({
        getItem: () => {
          throw cause;
        },
      }),
    );

    try {
      getLocalStorageItem("read-key", Schema.String);
      expect.unreachable("expected the read to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalStorageOperationError);
      expect(error).toMatchObject({
        operation: "read",
        storageKey: "read-key",
        cause,
      });
    }
  });

  it("preserves decode failure context", async () => {
    const { getLocalStorageItem, LocalStorageOperationError } = await loadWithStorage(
      createStorage({ getItem: () => "not-json" }),
    );

    try {
      getLocalStorageItem("decode-key", Schema.String);
      expect.unreachable("expected decoding to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalStorageOperationError);
      expect(error).toMatchObject({
        operation: "decode",
        storageKey: "decode-key",
        cause: expect.anything(),
      });
    }
  });

  it("preserves write failure context", async () => {
    const cause = new Error("storage quota exceeded");
    const { LocalStorageOperationError, setLocalStorageItem } = await loadWithStorage(
      createStorage({
        setItem: () => {
          throw cause;
        },
      }),
    );

    try {
      setLocalStorageItem("write-key", "value", Schema.String);
      expect.unreachable("expected the write to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalStorageOperationError);
      expect(error).toMatchObject({
        operation: "write",
        storageKey: "write-key",
        cause,
      });
    }
  });

  it("preserves removal failure context", async () => {
    const cause = new Error("storage unavailable");
    const { LocalStorageOperationError, removeLocalStorageItem } = await loadWithStorage(
      createStorage({
        removeItem: () => {
          throw cause;
        },
      }),
    );

    try {
      removeLocalStorageItem("remove-key");
      expect.unreachable("expected the removal to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(LocalStorageOperationError);
      expect(error).toMatchObject({
        operation: "remove",
        storageKey: "remove-key",
        cause,
      });
    }
  });

  it("rejects oversized UTF-8 values before decoding or writing", async () => {
    const setItem = vi.fn();
    const storage = createStorage({ getItem: () => JSON.stringify("éé"), setItem });
    const { getLocalStorageItem, setLocalStorageItem } = await loadWithStorage(storage);

    expect(() => getLocalStorageItem("read-limit", Schema.String, { maxEncodedBytes: 5 })).toThrow(
      expect.objectContaining({
        operation: "read",
        storageKey: "read-limit",
        cause: expect.objectContaining({ message: expect.stringContaining("5 UTF-8 bytes") }),
      }),
    );
    expect(() =>
      setLocalStorageItem("write-limit", "éé", Schema.String, { maxEncodedBytes: 5 }),
    ).toThrow(
      expect.objectContaining({
        operation: "write",
        storageKey: "write-limit",
        cause: expect.objectContaining({ message: expect.stringContaining("5 UTF-8 bytes") }),
      }),
    );
    expect(setItem).not.toHaveBeenCalled();
  });
});
