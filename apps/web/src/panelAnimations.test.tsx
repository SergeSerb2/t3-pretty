import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { usePanelEnterHold, usePanelNavigationSuppression } from "./panelAnimations";

let renderer: ReactTestRenderer | null = null;
let pendingFrames: FrameRequestCallback[] = [];
let observed: boolean[] = [];

type EnterHoldProps = { open: boolean; present: boolean; animated: boolean };

function EnterHoldProbe({ open, present, animated }: EnterHoldProps) {
  const holding = usePanelEnterHold(open, present, animated);
  useLayoutEffect(() => {
    observed.push(holding);
  }, [holding]);
  return null;
}

async function renderEnterHold(props: EnterHoldProps) {
  await act(() => {
    if (renderer) renderer.update(<EnterHoldProbe {...props} />);
    else renderer = create(<EnterHoldProbe {...props} />);
  });
}

function SuppressionProbe({ navigationKey }: { navigationKey: string }) {
  const suppressed = usePanelNavigationSuppression(navigationKey);
  useLayoutEffect(() => {
    observed.push(suppressed);
  }, [suppressed]);
  return null;
}

beforeEach(() => {
  pendingFrames = [];
  observed = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      pendingFrames.push(callback);
      return pendingFrames.length;
    }),
    cancelAnimationFrame: vi.fn(),
  });
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

async function paintPendingFrame() {
  const callback = pendingFrames.shift();
  await act(() => callback?.(0));
}

describe("usePanelNavigationSuppression", () => {
  it("suppresses initial and navigated panel state until each route has painted", async () => {
    await act(() => {
      renderer = create(<SuppressionProbe navigationKey="/thread/one" />);
    });
    expect(observed.at(-1)).toBe(true);

    await paintPendingFrame();
    expect(observed.at(-1)).toBe(true);
    await paintPendingFrame();
    expect(observed.at(-1)).toBe(false);

    await act(() => {
      renderer?.update(<SuppressionProbe navigationKey="/thread/two" />);
    });
    expect(observed.at(-1)).toBe(true);

    await paintPendingFrame();
    expect(observed.at(-1)).toBe(true);
    await paintPendingFrame();
    expect(observed.at(-1)).toBe(false);
  });
});

describe("usePanelEnterHold", () => {
  it("holds an animated panel closed for two frames after it mounts", async () => {
    await renderEnterHold({ open: true, present: true, animated: true });
    expect(observed.at(-1)).toBe(true);

    await paintPendingFrame();
    expect(observed.at(-1)).toBe(true);
    await paintPendingFrame();
    expect(observed.at(-1)).toBe(false);
  });

  it("never holds a restored panel, even once motion resumes", async () => {
    await renderEnterHold({ open: true, present: true, animated: false });
    await renderEnterHold({ open: true, present: true, animated: true });
    expect(observed).toEqual([false]);
    expect(pendingFrames).toHaveLength(0);
  });

  it("reverses a closing panel in place and holds again after it unmounts", async () => {
    await renderEnterHold({ open: true, present: true, animated: false });
    await renderEnterHold({ open: false, present: true, animated: true });
    await renderEnterHold({ open: true, present: true, animated: true });
    expect(observed).toEqual([false]);
    expect(pendingFrames).toHaveLength(0);

    await renderEnterHold({ open: false, present: false, animated: true });
    await renderEnterHold({ open: true, present: true, animated: true });
    expect(observed.at(-1)).toBe(true);
    await paintPendingFrame();
    await paintPendingFrame();
    expect(observed.at(-1)).toBe(false);
  });
});
