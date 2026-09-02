import type { WorkerStats } from "@pierre/diffs/worker";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  DIFF_WORKER_POOL_IDLE_MS,
  createDiffWorkerPoolIdleTerminator,
  enqueueDiffWorkerThemeSync,
  isDiffWorkerPoolIdle,
  syncDiffWorkerPoolTheme,
} from "./DiffWorkerPoolProvider.logic";
import providerSource from "./DiffWorkerPoolProvider.tsx?raw";

function stats(overrides: Partial<WorkerStats> = {}): WorkerStats {
  return {
    managerState: "initialized",
    workersFailed: false,
    totalWorkers: 3,
    busyWorkers: 0,
    queuedTasks: 0,
    activeTasks: 0,
    themeSubscribers: 0,
    fileCacheSize: 0,
    diffCacheSize: 0,
    ...overrides,
  };
}

describe("isDiffWorkerPoolIdle", () => {
  it("is idle only when initialized with no instances or tasks", () => {
    expect(isDiffWorkerPoolIdle(stats())).toBe(true);
    expect(isDiffWorkerPoolIdle(stats({ managerState: "waiting" }))).toBe(false);
    expect(isDiffWorkerPoolIdle(stats({ managerState: "initializing" }))).toBe(false);
    expect(isDiffWorkerPoolIdle(stats({ themeSubscribers: 1 }))).toBe(false);
    expect(isDiffWorkerPoolIdle(stats({ activeTasks: 1 }))).toBe(false);
    expect(isDiffWorkerPoolIdle(stats({ queuedTasks: 1 }))).toBe(false);
  });
});

describe("createDiffWorkerPoolIdleTerminator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function pool(current: WorkerStats) {
    const state = { current };
    return {
      state,
      terminate: vi.fn(() => {
        state.current = stats({ managerState: "waiting", totalWorkers: 0 });
      }),
      getStats: () => state.current,
    };
  }

  it("terminates after the idle window when nothing is mounted", () => {
    const p = pool(stats());
    const onStats = createDiffWorkerPoolIdleTerminator(p);
    onStats(p.state.current);
    vi.advanceTimersByTime(DIFF_WORKER_POOL_IDLE_MS - 1);
    expect(p.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(p.terminate).toHaveBeenCalledTimes(1);
    // Terminated pool sits in "waiting"; no re-arm until it boots again.
    onStats(p.state.current);
    vi.advanceTimersByTime(DIFF_WORKER_POOL_IDLE_MS);
    expect(p.terminate).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending teardown when a diff surface mounts", () => {
    const p = pool(stats());
    const onStats = createDiffWorkerPoolIdleTerminator(p);
    onStats(p.state.current);
    vi.advanceTimersByTime(DIFF_WORKER_POOL_IDLE_MS / 2);
    p.state.current = stats({ themeSubscribers: 1 });
    onStats(p.state.current);
    vi.advanceTimersByTime(DIFF_WORKER_POOL_IDLE_MS);
    expect(p.terminate).not.toHaveBeenCalled();
    // Unmount restarts a full window rather than resuming the old one.
    p.state.current = stats();
    onStats(p.state.current);
    vi.advanceTimersByTime(DIFF_WORKER_POOL_IDLE_MS - 1);
    expect(p.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(p.terminate).toHaveBeenCalledTimes(1);
  });

  it("re-checks live stats before terminating", () => {
    const p = pool(stats());
    const onStats = createDiffWorkerPoolIdleTerminator(p);
    onStats(p.state.current);
    // A task started but its stat broadcast has not been delivered yet.
    p.state.current = stats({ activeTasks: 1 });
    vi.advanceTimersByTime(DIFF_WORKER_POOL_IDLE_MS);
    expect(p.terminate).not.toHaveBeenCalled();
  });
});

describe("syncDiffWorkerPoolTheme", () => {
  it("retargets the existing pool when the painted Pierre theme changes", async () => {
    const setRenderOptions = vi.fn(async () => undefined);
    await syncDiffWorkerPoolTheme(
      {
        getDiffRenderOptions: () => ({
          theme: "pierre-dark",
          tokenizeMaxLineLength: 1_000,
        }),
        setRenderOptions,
      },
      "pierre-light",
    );

    expect(setRenderOptions).toHaveBeenCalledWith({
      theme: "pierre-light",
      tokenizeMaxLineLength: 1_000,
    });
  });

  it("leaves the pool alone when the Pierre theme already matches", async () => {
    const setRenderOptions = vi.fn(async () => undefined);
    await syncDiffWorkerPoolTheme(
      {
        getDiffRenderOptions: () => ({ theme: "pierre-light" }),
        setRenderOptions,
      },
      "pierre-light",
    );

    expect(setRenderOptions).not.toHaveBeenCalled();
  });
});

describe("DiffWorkerPoolProvider painted theme", () => {
  it("reconfigures the singleton pool when the painted appearance changes", () => {
    expect(providerSource).toContain("usePaintedAppearance");
    expect(providerSource).toContain("useState(() => getDiffWorkerPool(diffThemeName))");
    expect(providerSource).toContain("syncDiffWorkerPoolTheme(pool, diffThemeName)");
    expect(providerSource).toContain("[diffThemeName, pool]");
  });
});

describe("enqueueDiffWorkerThemeSync", () => {
  it("keeps the newest async theme write last", async () => {
    const pool = {};
    let releaseFirst: (() => void) | undefined;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const writes: string[] = [];

    const first = enqueueDiffWorkerThemeSync(pool, async () => {
      writes.push("first:start");
      await firstPending;
      writes.push("first:end");
    });
    const second = enqueueDiffWorkerThemeSync(pool, async () => {
      writes.push("second");
    });

    await Promise.resolve();
    expect(writes).toEqual(["first:start"]);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(writes).toEqual(["first:start", "first:end", "second"]);
  });

  it("continues after an earlier write rejects", async () => {
    const pool = {};
    const first = enqueueDiffWorkerThemeSync(pool, async () => {
      throw new Error("theme failed");
    });
    const second = enqueueDiffWorkerThemeSync(pool, async () => undefined);

    await expect(first).rejects.toThrow("theme failed");
    await expect(second).resolves.toBeUndefined();
  });
});
