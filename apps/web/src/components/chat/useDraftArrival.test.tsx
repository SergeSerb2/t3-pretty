import { act, StrictMode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const preference = vi.hoisted(() => ({ reducedMotion: false }));
vi.mock("../../hooks/useMediaQuery", () => ({
  useMediaQuery: () => preference.reducedMotion,
}));

import { useDraftArrival } from "./useDraftArrival";

function Draft({ threadKey, enabled = true }: { threadKey: string; enabled?: boolean }) {
  const ref = useDraftArrival(threadKey, enabled);
  return <div ref={ref} />;
}

let renderer: ReactTestRenderer | undefined;
const running = new Set<object>();
const element = {
  animate: () => {
    const animation = { cancel: () => running.delete(animation) };
    running.add(animation);
    return animation;
  },
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  preference.reducedMotion = false;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  expect(running.size).toBe(0);
  vi.unstubAllGlobals();
});

async function mount(threadKey: string, enabled = true) {
  await act(async () => {
    renderer = create(
      <StrictMode>
        <Draft threadKey={threadKey} enabled={enabled} />
      </StrictMode>,
      { createNodeMock: () => element },
    );
  });
}
async function update(threadKey: string, enabled = true) {
  await act(async () => {
    renderer?.update(
      <StrictMode>
        <Draft threadKey={threadKey} enabled={enabled} />
      </StrictMode>,
    );
  });
}

describe("draft arrival lifetime", () => {
  it("has one live arrival after StrictMode replay and unrelated renders", async () => {
    await mount("strict-draft");
    expect(running.size).toBe(1);
    const animation = [...running][0];
    await update("strict-draft");
    expect([...running]).toEqual([animation]);
  });

  it("cancels a superseded arrival and does not replay a revisited draft", async () => {
    await mount("rapid-a");
    const first = [...running][0];
    await update("rapid-b");
    expect(running.size).toBe(1);
    expect(running.has(first!)).toBe(false);
    await update("rapid-a");
    expect(running.size).toBe(0);
  });

  it("cancels immediately when sending docks the composer or motion is disabled", async () => {
    await mount("send-draft");
    await update("send-draft", false);
    expect(running.size).toBe(0);
    await update("send-draft", true);
    expect(running.size).toBe(0);
  });

  it("cancels when reduced motion changes and does not restart on re-enable", async () => {
    await mount("preference-draft");
    preference.reducedMotion = true;
    await update("preference-draft");
    expect(running.size).toBe(0);
    preference.reducedMotion = false;
    await update("preference-draft");
    expect(running.size).toBe(0);
  });

  it("never starts for reduced motion or a non-scenery composer", async () => {
    preference.reducedMotion = true;
    await mount("reduced-draft");
    expect(running.size).toBe(0);
    preference.reducedMotion = false;
    await update("plain-draft", false);
    expect(running.size).toBe(0);
  });

  it("does not replay when a visited draft remounts", async () => {
    await mount("remount-draft");
    await act(async () => renderer?.unmount());
    await mount("remount-draft");
    expect(running.size).toBe(0);
  });

  it("does not arrive late when motion is enabled on an existing draft", async () => {
    await mount("initially-disabled-draft", false);
    await update("initially-disabled-draft", true);
    expect(running.size).toBe(0);
  });
});
