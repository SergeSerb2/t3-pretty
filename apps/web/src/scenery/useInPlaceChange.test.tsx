import { act, StrictMode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useInPlaceChange } from "./useInPlaceChange";

const seen: boolean[] = [];

function Probe({ value, scope }: { value: string | null; scope: string }) {
  seen.push(useInPlaceChange(value, scope));
  return null;
}

let renderer: ReactTestRenderer | undefined;

async function render(value: string | null, scope: string) {
  await act(async () => {
    const element = (
      <StrictMode>
        <Probe value={value} scope={scope} />
      </StrictMode>
    );
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
  return seen.at(-1);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  seen.length = 0;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("useInPlaceChange", () => {
  it("stays quiet on first render and on renders that keep the value", async () => {
    expect(await render("New thread", "thread-a")).toBe(false);
    expect(await render("New thread", "thread-a")).toBe(false);
  });

  it("reports a change made in place and keeps reporting later ones", async () => {
    await render("New thread", "thread-a");
    expect(await render("Fix the flaky sidebar test", "thread-a")).toBe(true);
    // A value that returns to where it started is still a change the user watched.
    expect(await render("New thread", "thread-a")).toBe(true);
  });

  it("treats a status appearing from nothing as a change", async () => {
    await render(null, "thread-a");
    expect(await render("working", "thread-a")).toBe(true);
  });

  it("starts clean when the scope moves to another thread", async () => {
    await render("New thread", "thread-a");
    await render("Generated title", "thread-a");
    expect(await render("Another thread's title", "thread-b")).toBe(false);
    expect(await render("Another thread's title", "thread-b")).toBe(false);
  });
});
