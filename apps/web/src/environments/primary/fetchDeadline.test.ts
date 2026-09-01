import { afterEach, expect, it, vi } from "vite-plus/test";

import { fetchPrimaryEnvironmentWithDeadline } from "./fetchDeadline";

afterEach(() => {
  vi.useRealTimers();
});

it("aborts a primary environment fetch that outlives its deadline", async () => {
  vi.useFakeTimers();
  const observedSignals: AbortSignal[] = [];
  const fetchImplementation = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        observedSignals.push(signal);
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  ) as unknown as typeof fetch;

  const request = fetchPrimaryEnvironmentWithDeadline(
    fetchImplementation,
    "https://environment.test/session",
    undefined,
    25,
  );
  const rejection = expect(request).rejects.toEqual(
    expect.objectContaining({ name: "TimeoutError" }),
  );
  await vi.advanceTimersByTimeAsync(25);

  await rejection;
  expect(observedSignals[0]?.aborted).toBe(true);
});

it("forwards caller cancellation instead of waiting for the deadline", async () => {
  vi.useFakeTimers();
  const upstream = new AbortController();
  const observedSignals: AbortSignal[] = [];
  const fetchImplementation = vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        observedSignals.push(signal);
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  ) as unknown as typeof fetch;
  const reason = new Error("cancelled");

  const request = fetchPrimaryEnvironmentWithDeadline(
    fetchImplementation,
    "https://environment.test/session",
    { signal: upstream.signal },
    25,
  );
  const rejection = expect(request).rejects.toBe(reason);
  upstream.abort(reason);

  await rejection;
  expect(observedSignals[0]?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
