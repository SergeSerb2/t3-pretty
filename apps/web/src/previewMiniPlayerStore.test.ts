import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  browserMiniPlayerSource,
  normalizePersistedMiniPlayerState,
  type PreviewMiniPlayerSource,
  selectThreadPreviewMiniPlayer,
  selectThreadPreviewMiniPlayerTabId,
  usePreviewMiniPlayerStore,
} from "./previewMiniPlayerStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-B"));
const tabA = browserMiniPlayerSource("tab-a");
const tabB = browserMiniPlayerSource("tab-b");
const pixel: PreviewMiniPlayerSource = {
  kind: "device",
  hostId: "nucbox",
  deviceId: "emulator-5580",
  platform: "android",
  name: "Pixel",
};

beforeEach(() => {
  usePreviewMiniPlayerStore.setState({ byThreadKey: {}, dismissedTabIdsByThreadKey: {} });
});

describe("previewMiniPlayerStore", () => {
  it("keeps floating previews scoped to their thread", () => {
    usePreviewMiniPlayerStore.getState().open(refA, tabA);
    usePreviewMiniPlayerStore.getState().open(refB, tabB);

    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toMatchObject({ source: tabA });
    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refB),
    ).toMatchObject({ source: tabB });
  });

  it("preserves position when switching the floating tab within one thread", () => {
    usePreviewMiniPlayerStore.getState().open(refA, tabA);
    usePreviewMiniPlayerStore.getState().move(refA, "browser:tab-a", { x: 24, y: 48 });
    usePreviewMiniPlayerStore.getState().open(refA, tabB);

    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toEqual({
      source: tabB,
      position: { x: 24, y: 48 },
      width: null,
    });
  });

  it("ignores stale drag updates after the floating tab changes", () => {
    usePreviewMiniPlayerStore.getState().open(refA, tabA);
    usePreviewMiniPlayerStore.getState().open(refA, tabB);
    usePreviewMiniPlayerStore.getState().move(refA, "browser:tab-a", { x: 100, y: 100 });

    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toEqual({
      source: tabB,
      position: null,
      width: null,
    });
  });

  it("preserves a thread-bound width while switching tabs", () => {
    usePreviewMiniPlayerStore.getState().open(refA, tabA);
    usePreviewMiniPlayerStore.getState().resize(refA, "browser:tab-a", 480);
    usePreviewMiniPlayerStore.getState().open(refA, tabB);

    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toMatchObject({ source: tabB, width: 480 });
  });

  it("floats one source per thread, so a device replaces the browser tab", () => {
    usePreviewMiniPlayerStore.getState().open(refA, tabA);
    usePreviewMiniPlayerStore.getState().open(refA, pixel);
    const floating = selectThreadPreviewMiniPlayer(
      usePreviewMiniPlayerStore.getState().byThreadKey,
      refA,
    );

    expect(floating).toMatchObject({ source: pixel });
    expect(
      selectThreadPreviewMiniPlayerTabId(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toBeNull();
    // The same device under a new label is still the same floating source.
    usePreviewMiniPlayerStore.getState().open(refA, { ...pixel, name: "Renamed" });
    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toBe(floating);
  });

  it("keeps dismissed tabs independently and does not undismiss on open", () => {
    const store = usePreviewMiniPlayerStore.getState();
    store.open(refA, "tab-a");
    store.dismiss(refA, "tab-a");
    store.open(refA, "tab-b");

    expect(usePreviewMiniPlayerStore.getState().dismissedTabIdsByThreadKey).toEqual({
      [scopedThreadKey(refA)]: ["tab-a"],
    });

    usePreviewMiniPlayerStore.getState().dismiss(refA, "tab-b");

    expect(usePreviewMiniPlayerStore.getState().dismissedTabIdsByThreadKey).toEqual({
      [scopedThreadKey(refA)]: ["tab-a", "tab-b"],
    });
    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toBeNull();

    usePreviewMiniPlayerStore.getState().open(refA, "tab-b");

    expect(usePreviewMiniPlayerStore.getState().dismissedTabIdsByThreadKey).toEqual({
      [scopedThreadKey(refA)]: ["tab-a", "tab-b"],
    });
    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toMatchObject({ tabId: "tab-b" });

    usePreviewMiniPlayerStore.getState().undismiss(refA, "tab-b");

    expect(usePreviewMiniPlayerStore.getState().dismissedTabIdsByThreadKey).toEqual({
      [scopedThreadKey(refA)]: ["tab-a"],
    });
  });

  it("does not auto-present a dismissed tab", () => {
    const store = usePreviewMiniPlayerStore.getState();
    store.open(refA, "tab-a");
    store.dismiss(refA, "tab-a");
    store.openIfNotDismissed(refA, "tab-a");

    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toBeNull();

    usePreviewMiniPlayerStore.getState().open(refA, "tab-a");
    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toMatchObject({ tabId: "tab-a" });
  });

  it("keeps only string tab ids from persisted dismissal state", () => {
    expect(
      normalizePersistedMiniPlayerState({
        dismissedTabIdsByThreadKey: { "env-1:thread-A": ["tab-a", 1, null] },
      }),
    ).toEqual({
      dismissedTabIdsByThreadKey: { "env-1:thread-A": ["tab-a"] },
    });
  });

  it("undismisses a tab without opening its floating player", () => {
    const store = usePreviewMiniPlayerStore.getState();
    store.open(refA, "tab-a");
    store.dismiss(refA, "tab-a");
    store.undismiss(refA, "tab-a");

    expect(usePreviewMiniPlayerStore.getState().dismissedTabIdsByThreadKey).toEqual({});
    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toBeNull();
  });

  it("hides the player from close() without recording a dismissal", () => {
    const store = usePreviewMiniPlayerStore.getState();
    store.open(refA, "tab-a");
    store.close(refA);

    expect(usePreviewMiniPlayerStore.getState().dismissedTabIdsByThreadKey).toEqual({});
    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, refA),
    ).toBeNull();

    store.open(refA, "tab-a");
    store.dismiss(refA, "tab-a");
    store.open(refA, "tab-b");
    store.close(refA);

    expect(usePreviewMiniPlayerStore.getState().dismissedTabIdsByThreadKey).toEqual({
      [scopedThreadKey(refA)]: ["tab-a"],
    });
  });
});
