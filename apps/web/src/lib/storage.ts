import { Debouncer } from "@tanstack/react-pacer";

export interface StateStorage<R = unknown> {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => R;
  removeItem: (name: string) => R;
}

export interface SynchronousStateStorage extends StateStorage<void> {
  getItem: (name: string) => string | null;
}

export interface DeferredStorage<TValue> {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: TValue) => void;
  removeItem: (name: string) => void;
  flush: () => void;
}

export function createMemoryStorage(): SynchronousStateStorage {
  const store = new Map<string, string>();
  return {
    getItem: (name) => store.get(name) ?? null,
    setItem: (name, value) => {
      store.set(name, value);
    },
    removeItem: (name) => {
      store.delete(name);
    },
  };
}

export function isStateStorage(
  storage: Partial<StateStorage> | null | undefined,
): storage is StateStorage {
  return (
    storage !== null &&
    storage !== undefined &&
    typeof storage.getItem === "function" &&
    typeof storage.setItem === "function" &&
    typeof storage.removeItem === "function"
  );
}

export function resolveStorage(storage: Partial<StateStorage> | null | undefined): StateStorage {
  return isStateStorage(storage) ? storage : createMemoryStorage();
}

/**
 * Accessing the `localStorage` property can itself throw when browser policy
 * blocks persistence (for example in a sandboxed frame). Persisted stores are
 * initialized at module load, so keep that getter behind the same fallback as
 * an absent storage implementation.
 */
export function resolveLocalStorage(): SynchronousStateStorage {
  try {
    return typeof window !== "undefined" ? window.localStorage : createMemoryStorage();
  } catch {
    return createMemoryStorage();
  }
}

/** Keep the latest value and serialize it when the debounce fires or `flush` runs. */
export function createDeferredStorage<TValue>(
  baseStorage: Partial<StateStorage> | null | undefined,
  serialize: (value: TValue) => string,
  debounceMs: number = 300,
): DeferredStorage<TValue> {
  const resolvedStorage = resolveStorage(baseStorage);
  const debouncedSetItem = new Debouncer(
    (name: string, value: TValue) => {
      try {
        resolvedStorage.setItem(name, serialize(value));
      } catch {
        // Quota and browser-policy failures happen after the initiating render.
        // Keep them from surfacing as uncaught timer errors.
      }
    },
    { wait: debounceMs },
  );

  return {
    getItem: (name) => {
      try {
        return resolvedStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      debouncedSetItem.maybeExecute(name, value);
    },
    removeItem: (name) => {
      debouncedSetItem.cancel();
      debouncedSetItem.reset();
      try {
        resolvedStorage.removeItem(name);
      } catch {
        // Storage cleanup is best effort in restricted browser contexts.
      }
    },
    flush: () => {
      debouncedSetItem.flush();
    },
  };
}

/** Compatibility for stores that already supply serialized strings. */
export function createDebouncedStorage(
  baseStorage: Partial<StateStorage> | null | undefined,
  debounceMs = 300,
) {
  return createDeferredStorage(baseStorage, (value: string) => value, debounceMs);
}
