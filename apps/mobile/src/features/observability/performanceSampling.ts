interface KeyedPerformanceSampleGateOptions {
  readonly windowMs: number;
  readonly maxKeys?: number;
  readonly now?: () => number;
}

/** A small LRU gate for high-frequency performance signals keyed by screen resource. */
export function createKeyedPerformanceSampleGate(options: KeyedPerformanceSampleGateOptions) {
  const maxKeys = options.maxKeys ?? 64;
  const now = options.now ?? (() => performance.now());
  const sampledAtByKey = new Map<string, number>();

  return (key: string): boolean => {
    const sampledAt = now();
    const previous = sampledAtByKey.get(key);
    if (
      previous !== undefined &&
      sampledAt >= previous &&
      sampledAt - previous < options.windowMs
    ) {
      return false;
    }

    sampledAtByKey.delete(key);
    sampledAtByKey.set(key, sampledAt);
    while (sampledAtByKey.size > maxKeys) {
      const oldestKey = sampledAtByKey.keys().next().value;
      if (oldestKey === undefined) break;
      sampledAtByKey.delete(oldestKey);
    }
    return true;
  };
}
