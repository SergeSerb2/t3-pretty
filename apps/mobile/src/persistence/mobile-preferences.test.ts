import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

vi.mock("expo-secure-store", () => ({}));

import { MobileDatabase } from "./mobile-database";
import * as MobilePreferences from "./mobile-preferences";
import { MobileSecureStorage } from "./mobile-secure-storage";

describe("mobile legacy queue preference", () => {
  it.effect("retires the old queue default and persists opting in and back out", () =>
    Effect.gen(function* () {
      let stored = {
        payload: JSON.stringify({ followUpBehavior: "queue", baseFontSize: 18 }),
        updatedAt: 1,
      };
      const unused = Effect.die("Unexpected cache operation");
      const store = yield* MobilePreferences.make().pipe(
        Effect.provideService(MobileDatabase, {
          loadCache: () => unused,
          listCache: () => unused,
          saveCache: () => unused,
          removeCache: () => unused,
          pruneCacheKind: () => unused,
          clearCacheKind: () => unused,
          clearEnvironmentCache: () => unused,
          clearAllCaches: unused,
          inspectCaches: unused,
          loadPreferencesJson: Effect.sync(() => Option.some(stored)),
          savePreferencesJson: (payload, updatedAt) =>
            Effect.sync(() => {
              stored = { payload, updatedAt };
            }),
        }),
        Effect.provideService(MobileSecureStorage, {
          getItem: () => Effect.succeed(null),
          setItem: () => Effect.void,
          removeItem: () => Effect.void,
        }),
      );

      expect(yield* store.load).toEqual({ baseFontSize: 18 });
      yield* store.savePatch({ legacyQueueEnabled: true });
      expect(yield* store.load).toEqual({ baseFontSize: 18, legacyQueueEnabled: true });
      yield* store.savePatch({ legacyQueueEnabled: false });
      expect(yield* store.load).toEqual({ baseFontSize: 18, legacyQueueEnabled: false });
      const agentMonitoringEnrollment = {
        enabled: true,
        sentryDsn: "https://public@example.com/1",
      };
      yield* store.savePatch({ agentMonitoringEnrollment });
      expect((yield* store.load).agentMonitoringEnrollment).toEqual(agentMonitoringEnrollment);
      yield* store.savePatch({ agentMonitoringEnrollment: null });
      expect((yield* store.load).agentMonitoringEnrollment).toBeNull();
    }),
  );
});
