import type { WorkerStats } from "@pierre/diffs/worker";

/** Idle window before the diff worker pool is torn down (workers + AST caches). */
export const DIFF_WORKER_POOL_IDLE_MS = 90_000;

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
