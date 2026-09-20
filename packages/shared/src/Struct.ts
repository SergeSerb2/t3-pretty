import * as P from "effect/Predicate";

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? readonly DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export function deepMerge<T extends Record<string, unknown>>(current: T, patch: DeepPartial<T>): T {
  if (!P.isObject(current) || !P.isObject(patch)) {
    return patch as T;
  }

  const next = { ...current } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    const existing = next[key];
    const merged = P.isObject(existing) && P.isObject(value) ? deepMerge(existing, value) : value;
    // `next["__proto__"] = value` invokes Object.prototype's legacy setter.
    // Defining an own data property keeps JSON-derived keys inert and gives
    // every record key the same merge semantics.
    Object.defineProperty(next, key, {
      configurable: true,
      enumerable: true,
      value: merged,
      writable: true,
    });
  }

  return next as T;
}
