import * as Schema from "effect/Schema";
import * as Record from "effect/Record";
import { useCallback, useMemo, useSyncExternalStore } from "react";

export class LocalStorageOperationError extends Schema.TaggedErrorClass<LocalStorageOperationError>()(
  "LocalStorageOperationError",
  {
    operation: Schema.Literals(["read", "decode", "encode", "update", "write", "remove", "notify"]),
    storageKey: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} local storage item ${this.storageKey}.`;
  }
}

function createMemoryLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (_) => store.get(_) ?? null,
    key: (_) => Record.keys(store).at(_) ?? null,
    get length() {
      return store.size;
    },
    removeItem: (_) => store.delete(_),
    setItem: (_, value) => store.set(_, value),
  };
}

function resolveIsomorphicLocalStorage(): Storage {
  try {
    return typeof window !== "undefined" ? window.localStorage : createMemoryLocalStorage();
  } catch {
    return createMemoryLocalStorage();
  }
}

const isomorphicLocalStorage = resolveIsomorphicLocalStorage();

const read = (key: string) => {
  try {
    return isomorphicLocalStorage.getItem(key);
  } catch (cause) {
    throw new LocalStorageOperationError({ operation: "read", storageKey: key, cause });
  }
};

const decode = <T, E>(key: string, schema: Schema.Codec<T, E>, value: string) => {
  try {
    return Schema.decodeSync(Schema.fromJsonString(schema))(value);
  } catch (cause) {
    throw new LocalStorageOperationError({ operation: "decode", storageKey: key, cause });
  }
};

const encode = <T, E>(key: string, schema: Schema.Codec<T, E>, value: T) => {
  try {
    return Schema.encodeSync(Schema.fromJsonString(schema))(value);
  } catch (cause) {
    throw new LocalStorageOperationError({ operation: "encode", storageKey: key, cause });
  }
};

export interface LocalStorageItemSizeOptions {
  readonly maxEncodedBytes: number;
}

function exceedsUtf8ByteLimit(value: string, maximumBytes: number): boolean {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
    if (bytes > maximumBytes) return true;
  }
  return false;
}

function enforceEncodedSizeLimit(
  key: string,
  encoded: string,
  operation: "read" | "write",
  options?: LocalStorageItemSizeOptions,
): void {
  if (!options || !exceedsUtf8ByteLimit(encoded, options.maxEncodedBytes)) return;
  throw new LocalStorageOperationError({
    operation,
    storageKey: key,
    cause: new RangeError(
      `Encoded local storage value exceeds ${options.maxEncodedBytes} UTF-8 bytes.`,
    ),
  });
}

export const getLocalStorageItem = <T, E>(
  key: string,
  schema: Schema.Codec<T, E>,
  options?: LocalStorageItemSizeOptions,
): T | null => {
  const item = read(key);
  if (item) enforceEncodedSizeLimit(key, item, "read", options);
  return item ? decode(key, schema, item) : null;
};

export const setLocalStorageItem = <T, E>(
  key: string,
  value: T,
  schema: Schema.Codec<T, E>,
  options?: LocalStorageItemSizeOptions,
) => {
  const valueToSet = encode(key, schema, value);
  enforceEncodedSizeLimit(key, valueToSet, "write", options);
  try {
    isomorphicLocalStorage.setItem(key, valueToSet);
  } catch (cause) {
    throw new LocalStorageOperationError({ operation: "write", storageKey: key, cause });
  }
};

export const removeLocalStorageItem = (key: string) => {
  try {
    isomorphicLocalStorage.removeItem(key);
  } catch (cause) {
    throw new LocalStorageOperationError({ operation: "remove", storageKey: key, cause });
  }
};

const LOCAL_STORAGE_CHANGE_EVENT = "t3code:local_storage_change";

interface LocalStorageChangeDetail {
  key: string;
}

function dispatchLocalStorageChange(key: string) {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent<LocalStorageChangeDetail>(LOCAL_STORAGE_CHANGE_EVENT, {
        detail: { key },
      }),
    );
  } catch (cause) {
    throw new LocalStorageOperationError({ operation: "notify", storageKey: key, cause });
  }
}

export function useLocalStorage<T, E>(
  key: string,
  initialValue: T,
  schema: Schema.Codec<T, E>,
): [T, (value: T | ((val: T) => T)) => void] {
  const getSnapshot = useCallback(() => {
    try {
      return read(key);
    } catch (error) {
      console.error("[LOCALSTORAGE] Could not read stored value.", error);
      return null;
    }
  }, [key]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const handleStorageChange = (event: StorageEvent) => {
        if (
          (event.storageArea === null || event.storageArea === isomorphicLocalStorage) &&
          (event.key === key || event.key === null)
        ) {
          onStoreChange();
        }
      };
      const handleLocalChange = (event: CustomEvent<LocalStorageChangeDetail>) => {
        if (event.detail.key === key) {
          onStoreChange();
        }
      };

      window.addEventListener("storage", handleStorageChange);
      window.addEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalChange as EventListener);
      return () => {
        window.removeEventListener("storage", handleStorageChange);
        window.removeEventListener(LOCAL_STORAGE_CHANGE_EVENT, handleLocalChange as EventListener);
      };
    },
    [key],
  );

  const serializedValue = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const storedValue = useMemo(() => {
    if (serializedValue === null) {
      return initialValue;
    }
    try {
      return decode(key, schema, serializedValue);
    } catch (error) {
      console.error("[LOCALSTORAGE] Could not decode stored value.", error);
      return initialValue;
    }
  }, [initialValue, key, schema, serializedValue]);

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      try {
        const currentValue = getLocalStorageItem(key, schema) ?? initialValue;
        let valueToStore: T;
        if (typeof value === "function") {
          try {
            valueToStore = (value as (val: T) => T)(currentValue);
          } catch (cause) {
            throw new LocalStorageOperationError({
              operation: "update",
              storageKey: key,
              cause,
            });
          }
        } else {
          valueToStore = value;
        }
        if (valueToStore === null) {
          removeLocalStorageItem(key);
        } else {
          setLocalStorageItem(key, valueToStore, schema);
        }
        dispatchLocalStorageChange(key);
      } catch (error) {
        console.error("[LOCALSTORAGE] Could not update stored value.", error);
      }
    },
    [initialValue, key, schema],
  );

  return [storedValue, setValue];
}
