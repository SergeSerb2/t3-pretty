import type { WorkerStats } from "@pierre/diffs/worker";

import type { DiffThemeName } from "../lib/diffRendering";

const themeSyncTails = new WeakMap<object, Promise<void>>();

/**
 * Serializes asynchronous render-option writes for one worker pool. Theme
 * effects can overlap when the preference changes quickly; running each write
 * after the previous settlement guarantees the newest effect is the final
 * writer, while a rejected write cannot poison later updates.
 */
export function enqueueDiffWorkerThemeSync(pool: object, sync: () => Promise<void>): Promise<void> {
  const previous = themeSyncTails.get(pool) ?? Promise.resolve();
  const task = previous.then(sync);
  const tail = task.then(
    () => undefined,
    () => undefined,
  );
  themeSyncTails.set(pool, tail);
  void tail.then(() => {
    if (themeSyncTails.get(pool) === tail) {
      themeSyncTails.delete(pool);
    }
  });
  return task;
}

/** Idle window before the diff worker pool is torn down (workers + AST caches). */
export const DIFF_WORKER_POOL_IDLE_MS = 90_000;

type DiffWorkerPoolThemeTarget = {
  getDiffRenderOptions(): { readonly theme?: unknown };
  setRenderOptions(options: { theme: DiffThemeName }): Promise<void>;
};

/**
 * The page-level manager is created once so mounted diffs that captured it stay
 * valid. World Scenery can still flip the painted appearance later, so retarget
 * the existing Pierre theme instead of constructing a second pool.
 */
export async function syncDiffWorkerPoolTheme(
  pool: DiffWorkerPoolThemeTarget,
  themeName: DiffThemeName,
): Promise<void> {
  await enqueueDiffWorkerThemeSync(pool, async () => {
    const current = pool.getDiffRenderOptions();
    if (current.theme === themeName) {
      return;
    }

    await pool.setRenderOptions({
      ...current,
      theme: themeName,
    });
  });
}

/** Workers plus AST caches only earn their memory while a diff surface is mounted or a task is in flight. */
export function isDiffWorkerPoolIdle(stats: WorkerStats): boolean {
  return (
    // "initializing" is not idle: terminating mid-init bumps the lifecycle
    // generation and the pending setRenderOptions bails without storing the
    // theme, so the next diff would render in the previous one.
    stats.managerState === "initialized" &&
    stats.themeSubscribers === 0 &&
    stats.activeTasks === 0 &&
    stats.queuedTasks === 0
  );
}

/**
 * Stat-change subscriber that terminates the pool once it has been idle for `idleMs`.
 * The pool lazily re-initializes on its next render task, so terminate is a cheap
 * "release memory" rather than a shutdown.
 */
export function createDiffWorkerPoolIdleTerminator(
  pool: { getStats(): WorkerStats; terminate(): void },
  idleMs = DIFF_WORKER_POOL_IDLE_MS,
): (stats: WorkerStats) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (stats) => {
    if (!isDiffWorkerPoolIdle(stats)) {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      return;
    }
    timer ??= setTimeout(() => {
      timer = undefined;
      if (isDiffWorkerPoolIdle(pool.getStats())) {
        pool.terminate();
      }
    }, idleMs);
  };
}
