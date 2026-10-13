import { afterEach, expect, it, vi } from "vite-plus/test";

import { subscribeSecondTick } from "./secondTicker";

const releases: (() => void)[] = [];

afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shares one interval and visibility listener across many elapsed labels", () => {
  vi.useFakeTimers();
  const document = new EventTarget();
  let hidden = false;
  Object.defineProperty(document, "hidden", { get: () => hidden });
  vi.stubGlobal("document", document);
  const add = vi.spyOn(document, "addEventListener");
  const remove = vi.spyOn(document, "removeEventListener");
  const listeners = Array.from({ length: 250 }, () => vi.fn());
  for (const listener of listeners) releases.push(subscribeSecondTick(listener));
  expect(vi.getTimerCount()).toBe(1);
  expect(add).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(2_000);
  for (const listener of listeners) expect(listener).toHaveBeenCalledTimes(3);

  hidden = true;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(30_000);
  for (const listener of listeners) expect(listener).toHaveBeenCalledTimes(3);

  hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(vi.getTimerCount()).toBe(1);
  for (const listener of listeners) expect(listener).toHaveBeenCalledTimes(4);
  for (const release of releases.splice(0)) {
    release();
    release();
  }
  expect(vi.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledTimes(1);
  document.dispatchEvent(new Event("visibilitychange"));
  for (const listener of listeners) expect(listener).toHaveBeenCalledTimes(4);
});

it("keeps elapsed updates parked when a label first mounts in a hidden window", () => {
  vi.useFakeTimers();
  vi.stubGlobal("document", { hidden: true, addEventListener() {}, removeEventListener() {} });
  const listener = vi.fn();
  releases.push(subscribeSecondTick(listener));
  expect(listener).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(10_000);
  expect(listener).toHaveBeenCalledTimes(1);
});
