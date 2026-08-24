import { RESOURCE_ATTRIBUTION_ENTRY_MAX_COUNT } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as ResourceAttribution from "./ResourceAttribution.ts";

describe("ResourceAttribution", () => {
  it.effect("bounds retained keys while preserving overflow totals", () =>
    Effect.gen(function* () {
      const attribution = yield* ResourceAttribution.make();
      const recordCount = RESOURCE_ATTRIBUTION_ENTRY_MAX_COUNT + 5;
      yield* Effect.forEach(
        Array.from({ length: recordCount }, (_, index) => index),
        (index) =>
          attribution.record({
            component: `component-${index}`,
            operation: `operation-${index}`,
            logicalWriteBytes: 1,
          }),
        { discard: true },
      );

      const snapshot = yield* attribution.snapshot;
      expect(snapshot.entries).toHaveLength(RESOURCE_ATTRIBUTION_ENTRY_MAX_COUNT);
      expect(snapshot.entriesTruncated).toBe(true);
      expect(snapshot.entries.reduce((total, entry) => total + entry.count, 0)).toBe(recordCount);
      expect(snapshot.entries.reduce((total, entry) => total + entry.logicalWriteBytes, 0)).toBe(
        recordCount,
      );
      expect(
        snapshot.entries.find(
          (entry) => entry.component === "other" && entry.operation === "overflow",
        )?.count,
      ).toBe(6);
    }),
  );
});
