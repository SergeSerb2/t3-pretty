import { AtomRegistry } from "effect/reactivity";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  createSourceHighlightAtomFamily,
  type SourceHighlightTokens,
} from "./sourceHighlightingState";

const highlightedTokens: SourceHighlightTokens = [
  [{ content: "const", color: "#0000ff", fontStyle: null }],
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type SourceHighlightAtom = ReturnType<ReturnType<typeof createSourceHighlightAtomFamily>>;

/** Wait for the actual published result, rather than polling the highlighter. */
async function waitForHighlight(registry: AtomRegistry.AtomRegistry, atom: SourceHighlightAtom) {
  const settled = Promise.withResolvers<void>();
  const unsubscribe = registry.subscribe(
    atom,
    (result) => {
      if (AsyncResult.isSuccess(result) || AsyncResult.isFailure(result)) settled.resolve();
    },
    { immediate: true },
  );
  await settled.promise;
  unsubscribe();
  expect(AsyncResult.isSuccess(registry.get(atom))).toBe(true);
}

// Source nodes remove on the registry scheduler. Use microtasks to drain that
// known work without sleeps, polling, or access to private dispatchers.
function makeMicrotaskRegistry() {
  return AtomRegistry.make({
    scheduleTask(task) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) task();
      });
      return () => {
        cancelled = true;
      };
    },
  });
}

describe("sourceHighlightingState", () => {
  it("reuses completed highlighting across equivalent route remounts", async () => {
    const highlight = vi.fn(async () => highlightedTokens);
    const sourceHighlightAtom = createSourceHighlightAtomFamily({ highlight, idleTtlMs: 1_000 });
    const registry = AtomRegistry.make({ timeoutResolution: 1 });
    const input = {
      path: "src/example.ts",
      contents: "const value = 1;",
      theme: "light" as const,
    };
    const firstAtom = sourceHighlightAtom(input);
    const firstUnmount = registry.mount(firstAtom);

    await vi.waitFor(() => {
      expect(AsyncResult.isSuccess(registry.get(firstAtom))).toBe(true);
    });
    firstUnmount();

    const remountedAtom = sourceHighlightAtom({ ...input });
    const secondUnmount = registry.mount(remountedAtom);

    expect(remountedAtom).toBe(firstAtom);
    expect(AsyncResult.isSuccess(registry.get(remountedAtom))).toBe(true);
    expect(highlight).toHaveBeenCalledTimes(1);

    secondUnmount();
    registry.dispose();
  });

  it("does not reuse highlighting when the source contents change", async () => {
    const highlight = vi.fn(async () => highlightedTokens);
    const sourceHighlightAtom = createSourceHighlightAtomFamily({ highlight });
    const registry = AtomRegistry.make();
    const firstAtom = sourceHighlightAtom({
      path: "src/example.ts",
      contents: "const value = 1;",
      theme: "light",
    });
    const secondAtom = sourceHighlightAtom({
      path: "src/example.ts",
      contents: "const value = 2;",
      theme: "light",
    });
    const firstUnmount = registry.mount(firstAtom);
    const secondUnmount = registry.mount(secondAtom);

    await vi.waitFor(() => {
      expect(AsyncResult.isSuccess(registry.get(firstAtom))).toBe(true);
      expect(AsyncResult.isSuccess(registry.get(secondAtom))).toBe(true);
    });
    expect(secondAtom).not.toBe(firstAtom);
    expect(highlight).toHaveBeenCalledTimes(2);

    firstUnmount();
    secondUnmount();
    registry.dispose();
  });

  it("recomputes highlighting after the idle cache entry expires", async () => {
    const highlight = vi.fn(async () => highlightedTokens);
    const sourceHighlightAtom = createSourceHighlightAtomFamily({ highlight, idleTtlMs: 5 });
    const registry = AtomRegistry.make({ timeoutResolution: 1 });
    const atom = sourceHighlightAtom({
      path: "src/example.ts",
      contents: "const value = 1;",
      theme: "light",
    });
    const firstUnmount = registry.mount(atom);

    await vi.waitFor(() => {
      expect(AsyncResult.isSuccess(registry.get(atom))).toBe(true);
    });
    firstUnmount();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const secondUnmount = registry.mount(atom);
    await vi.waitFor(() => {
      expect(highlight).toHaveBeenCalledTimes(2);
      expect(AsyncResult.isSuccess(registry.get(atom))).toBe(true);
    });

    secondUnmount();
    registry.dispose();
  });

  it("exposes highlighter errors as a failed async result", async () => {
    const highlight = vi.fn(async () => {
      throw new Error("highlight failed");
    });
    const sourceHighlightAtom = createSourceHighlightAtomFamily({ highlight });
    const registry = AtomRegistry.make();
    const atom = sourceHighlightAtom({
      path: "src/example.ts",
      contents: "const value = 1;",
      theme: "light",
    });
    const unmount = registry.mount(atom);

    await vi.waitFor(() => {
      expect(AsyncResult.isFailure(registry.get(atom))).toBe(true);
    });

    unmount();
    registry.dispose();
  });

  it("releases idle file atoms while retaining a bounded cache for recent revisits", async () => {
    const highlight = vi.fn(async () => highlightedTokens);
    const family = createSourceHighlightAtomFamily({ highlight });
    const registry = makeMicrotaskRegistry();
    const inputs = Array.from({ length: 12 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      contents: `const value = ${index};`,
      theme: "light" as const,
    }));
    try {
      for (const input of inputs) {
        const atom = family(input);
        const unmount = registry.mount(atom);
        await waitForHighlight(registry, atom);
        unmount();
        await Promise.resolve();
      }
      expect(registry.getNodes().size).toBeLessThanOrEqual(1);
      const recent = family(inputs[11]!);
      const unmountRecent = registry.mount(recent);
      await waitForHighlight(registry, recent);
      expect(highlight).toHaveBeenCalledTimes(12);
      unmountRecent();
      await Promise.resolve();
      const oldest = family(inputs[0]!);
      const unmountOldest = registry.mount(oldest);
      await waitForHighlight(registry, oldest);
      expect(highlight).toHaveBeenCalledTimes(13);
      unmountOldest();
    } finally {
      registry.dispose();
    }
  });

  it("bounds retained source and token text before reaching the file count limit", async () => {
    const highlight = vi.fn(async (input: { contents: string }): Promise<SourceHighlightTokens> => [
      [{ content: input.contents, color: "blue", fontStyle: null }],
    ]);
    const family = createSourceHighlightAtomFamily({ highlight });
    const registry = makeMicrotaskRegistry();
    const inputs = Array.from({ length: 5 }, (_, index) => ({
      path: `src/large-${index}.ts`,
      contents: `${index}${"x".repeat(600_000)}`,
      theme: "light" as const,
    }));
    try {
      for (const input of inputs) {
        const atom = family(input);
        const unmount = registry.mount(atom);
        await waitForHighlight(registry, atom);
        unmount();
        await Promise.resolve();
      }
      const oldest = family(inputs[0]!);
      const unmount = registry.mount(oldest);
      await waitForHighlight(registry, oldest);
      expect(highlight).toHaveBeenCalledTimes(6);
      unmount();
    } finally {
      registry.dispose();
    }
  });

  it("bounds retained token objects and leaves an evicted mounted file usable", async () => {
    const highlight = vi.fn(async (input: { contents: string }): Promise<SourceHighlightTokens> => [
      [...input.contents].map((content) => ({ content, color: "blue", fontStyle: null })),
    ]);
    const family = createSourceHighlightAtomFamily({ highlight });
    const registry = makeMicrotaskRegistry();
    const inputs = Array.from({ length: 4 }, (_, index) => ({
      path: `src/tokens-${index}.ts`,
      contents: `${index}${"x".repeat(30_000)}`,
      theme: "light" as const,
    }));
    const active = family(inputs[0]!);
    const unmountActive = registry.mount(active);
    try {
      await waitForHighlight(registry, active);
      const mountedResult = registry.get(active);
      for (const input of inputs.slice(1)) {
        const atom = family(input);
        const unmount = registry.mount(atom);
        await waitForHighlight(registry, atom);
        unmount();
        await Promise.resolve();
      }
      expect(registry.get(active)).toBe(mountedResult);
      expect(highlight).toHaveBeenCalledTimes(4);
      unmountActive();
      await Promise.resolve();
      const unmountRevisit = registry.mount(family(inputs[0]!));
      await waitForHighlight(registry, family(inputs[0]!));
      expect(highlight).toHaveBeenCalledTimes(5);
      unmountRevisit();
    } finally {
      registry.dispose();
    }
  });

  it("keeps a quick revisit warm after a file stayed open longer than its idle window", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
    const highlight = vi.fn(async () => highlightedTokens);
    const family = createSourceHighlightAtomFamily({ highlight, idleTtlMs: 5_000 });
    const registry = makeMicrotaskRegistry();
    const input = {
      path: "src/active.ts",
      contents: "const active = true;",
      theme: "light" as const,
    };
    try {
      const atom = family(input);
      const unmount = registry.mount(atom);
      await waitForHighlight(registry, atom);
      vi.setSystemTime(60_000);
      const other = family({ ...input, path: "src/other.ts" });
      const unmountOther = registry.mount(other);
      await waitForHighlight(registry, other);
      unmountOther();
      await Promise.resolve();
      unmount();
      await Promise.resolve();
      const unmountRevisit = registry.mount(family(input));
      await waitForHighlight(registry, family(input));
      expect(highlight).toHaveBeenCalledTimes(2);
      unmountRevisit();
      await Promise.resolve();
      vi.setSystemTime(65_001);
      const unmountExpired = registry.mount(family(input));
      await waitForHighlight(registry, family(input));
      expect(highlight).toHaveBeenCalledTimes(3);
      unmountExpired();
    } finally {
      registry.dispose();
    }
  });

  it("releases the whole bounded cache after its idle window without another read", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(0);
    const highlight = vi.fn(async () => highlightedTokens);
    const family = createSourceHighlightAtomFamily({ highlight, idleTtlMs: 5_000 });
    const registry = makeMicrotaskRegistry();
    const atom = family({ path: "src/idle.ts", contents: "const value = 1;", theme: "light" });
    try {
      const unmount = registry.mount(atom);
      await waitForHighlight(registry, atom);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(AsyncResult.isSuccess(registry.get(atom))).toBe(true);
      unmount();
      await Promise.resolve();
      expect(registry.getNodes().size).toBe(1);
      // Registry expiry rounds to the next one-second bucket.
      await vi.advanceTimersByTimeAsync(6_001);
      expect(registry.getNodes().size).toBe(0);
    } finally {
      registry.dispose();
    }
  });

  it("cancels an abandoned highlight and does not cache its late result", async () => {
    const pending: Array<(tokens: SourceHighlightTokens) => void> = [];
    const signals: Array<AbortSignal | undefined> = [];
    const highlight = vi.fn((input: { signal?: AbortSignal }): Promise<SourceHighlightTokens> => {
      signals.push(input.signal);
      return new Promise((resolve) => pending.push(resolve));
    });
    const family = createSourceHighlightAtomFamily({ highlight });
    const registry = makeMicrotaskRegistry();
    const input = {
      path: "src/abandoned.ts",
      contents: "const value = 1;",
      theme: "light" as const,
    };
    try {
      const first = family(input);
      const unmountFirst = registry.mount(first);
      expect(signals[0]?.aborted).toBe(false);
      unmountFirst();
      await Promise.resolve();
      expect(signals[0]?.aborted).toBe(true);
      pending[0]!(highlightedTokens);
      await Promise.resolve();
      await Promise.resolve();

      const revisit = family(input);
      const unmountRevisit = registry.mount(revisit);
      expect(highlight).toHaveBeenCalledTimes(2);
      pending[1]!(highlightedTokens);
      await waitForHighlight(registry, revisit);
      unmountRevisit();
    } finally {
      registry.dispose();
    }
  });
});
