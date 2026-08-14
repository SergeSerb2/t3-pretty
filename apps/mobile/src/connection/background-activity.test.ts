import { EnvironmentId, type ClientActivityReportInput, WS_METHODS } from "@t3tools/contracts";
import { vi } from "vite-plus/test";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import {
  clientActivityReportSignature,
  createClientActivityReportTracker,
} from "./background-activity";
import {
  onRetainedMobileBackgroundScopesChange,
  observeMobileBackgroundActivitySubscription,
  retainedMobileBackgroundScopes,
} from "./background-activity-scopes";

vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
}));

vi.mock("../persistence/mobile-storage", () => ({
  MobileStorage: {},
}));

describe("mobile background activity", () => {
  it.effect("retains VCS demand only while the mobile subscription is active", () =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("mobile-environment");
      const release = yield* observeMobileBackgroundActivitySubscription({
        environmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "/workspace" },
      });

      expect(retainedMobileBackgroundScopes(environmentId)).toEqual([
        { type: "vcs-status", cwd: "/workspace" },
      ]);

      yield* release;
      expect(retainedMobileBackgroundScopes(environmentId)).toEqual([]);
    }),
  );

  it.effect("keeps delimiter-containing environment and scope values distinct", () =>
    Effect.gen(function* () {
      const firstEnvironmentId = EnvironmentId.make("a");
      const secondEnvironmentId = EnvironmentId.make("a:vcs-status:b");
      const releaseFirst = yield* observeMobileBackgroundActivitySubscription({
        environmentId: firstEnvironmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "b:vcs-status:c" },
      });
      const releaseSecond = yield* observeMobileBackgroundActivitySubscription({
        environmentId: secondEnvironmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "c" },
      });

      expect(retainedMobileBackgroundScopes(firstEnvironmentId)).toEqual([
        { type: "vcs-status", cwd: "b:vcs-status:c" },
      ]);
      expect(retainedMobileBackgroundScopes(secondEnvironmentId)).toEqual([
        { type: "vcs-status", cwd: "c" },
      ]);

      yield* Effect.all([releaseFirst, releaseSecond]);
    }),
  );

  it.effect("returns a release handle when a retained-scope listener throws", () =>
    Effect.gen(function* () {
      const environmentId = EnvironmentId.make("throwing-listener-environment");
      const removeListener = onRetainedMobileBackgroundScopesChange(() => {
        throw new Error("listener failed");
      });

      const release = yield* observeMobileBackgroundActivitySubscription({
        environmentId,
        method: WS_METHODS.subscribeVcsStatus,
        input: { cwd: "/workspace" },
      });
      expect(retainedMobileBackgroundScopes(environmentId)).toEqual([
        { type: "vcs-status", cwd: "/workspace" },
      ]);

      yield* release;
      expect(retainedMobileBackgroundScopes(environmentId)).toEqual([]);
      removeListener();
    }),
  );
});

describe("client activity report dedupe", () => {
  const environmentId = EnvironmentId.make("environment-1");

  function reportInput(overrides?: Partial<ClientActivityReportInput>): ClientActivityReportInput {
    return {
      environmentId,
      clientId: "mobile-device-1" as ClientActivityReportInput["clientId"],
      clientKind: "mobile",
      visible: true,
      focused: true,
      recentlyInteracted: true,
      appState: "active",
      scopes: [{ type: "provider-status" }],
      ttlMs: 45_000,
      observedAt: DateTime.makeUnsafe(0),
      ...overrides,
    };
  }

  it("skips a report whose content is unchanged since the last accepted one", () => {
    const tracker = createClientActivityReportTracker();
    const first = clientActivityReportSignature(reportInput());
    expect(tracker.shouldReport(environmentId, first)).toBe(true);

    tracker.markAccepted(environmentId, first);
    // A fresh observedAt timestamp must not defeat the dedupe.
    const sameContent = clientActivityReportSignature(
      reportInput({ observedAt: DateTime.makeUnsafe(25_000) }),
    );
    expect(sameContent).toBe(first);
    expect(tracker.shouldReport(environmentId, sameContent)).toBe(false);
  });

  it("reports again when app state or retained scopes change", () => {
    const tracker = createClientActivityReportTracker();
    tracker.markAccepted(environmentId, clientActivityReportSignature(reportInput()));

    const backgrounded = clientActivityReportSignature(
      reportInput({
        appState: "background",
        visible: false,
        focused: false,
        recentlyInteracted: false,
      }),
    );
    expect(tracker.shouldReport(environmentId, backgrounded)).toBe(true);

    const withRetainedScope = clientActivityReportSignature(
      reportInput({
        scopes: [{ type: "provider-status" }, { type: "vcs-status", cwd: "/workspace" }],
      }),
    );
    expect(tracker.shouldReport(environmentId, withRetainedScope)).toBe(true);
  });

  it("keeps sending after failures and after the environment is re-registered", () => {
    const tracker = createClientActivityReportTracker();
    const signature = clientActivityReportSignature(reportInput());

    // A failed send never marks, so the next interval still sends.
    expect(tracker.shouldReport(environmentId, signature)).toBe(true);

    tracker.markAccepted(environmentId, signature);
    expect(tracker.shouldReport(environmentId, signature)).toBe(false);

    // Pruning keeps a live environment's dedupe intact...
    tracker.prune(new Set([environmentId]));
    expect(tracker.shouldReport(environmentId, signature)).toBe(false);

    // ...but a removed environment reports again when it reappears.
    tracker.prune(new Set());
    expect(tracker.shouldReport(environmentId, signature)).toBe(true);
  });
});
