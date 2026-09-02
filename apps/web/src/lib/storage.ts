import { Debouncer } from "@tanstack/react-pacer";

export interface StateStorage<R = unknown> {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => R;
  removeItem: (name: string) => R;
}

export interface SynchronousStateStorage extends StateStorage<void> {
  getItem: (name: string) => string | null;
}

export interface DebouncedStorage<R = unknown> extends StateStorage<R> {
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

export function createDebouncedStorage(
  baseStorage: Partial<StateStorage> | null | undefined,
  debounceMs: number = 300,
): DebouncedStorage {
  const resolvedStorage = resolveStorage(baseStorage);
  const debouncedSetItem = new Debouncer(
    (name: string, value: string) => {
      try {
        resolvedStorage.setItem(name, value);
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
