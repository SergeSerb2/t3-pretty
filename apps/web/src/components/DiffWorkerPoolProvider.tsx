import { WorkerPoolContext, useWorkerPool } from "@pierre/diffs/react";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import * as Schema from "effect/Schema";
import { useEffect, useState, type ReactNode } from "react";
import { useTheme } from "../hooks/useTheme";
import { resolveDiffThemeName, type DiffThemeName } from "../lib/diffRendering";
import { createDiffWorkerPoolIdleTerminator } from "./DiffWorkerPoolProvider.logic";

export class DiffWorkerError extends Schema.TaggedErrorClass<DiffWorkerError>()("DiffWorkerError", {
  operation: Schema.Literals(["create-worker", "get-render-options", "set-render-options"]),
  themeName: Schema.Literals(["pierre-light", "pierre-dark"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Diff worker operation ${this.operation} failed for theme ${this.themeName}.`;
  }
}

function DiffWorkerThemeSync({ themeName }: { themeName: DiffThemeName }) {
  const workerPool = useWorkerPool();

  useEffect(() => {
    if (!workerPool) {
      return;
    }

    let operation: DiffWorkerError["operation"] = "get-render-options";
    void (async () => {
      try {
        const current = workerPool.getDiffRenderOptions();
        if (current.theme === themeName) {
          return;
        }

        operation = "set-render-options";
        await workerPool.setRenderOptions({
          ...current,
          theme: themeName,
        });
      } catch (cause) {
        console.error(new DiffWorkerError({ operation, themeName, cause }));
      }
    })();
  }, [themeName, workerPool]);

  return null;
}

// One pool per page. Workers (814 KB script + oniguruma wasm each) spawn on the first
// render task and are released after DIFF_WORKER_POOL_IDLE_MS without a mounted diff
// surface; the manager itself is kept so instances that captured it keep working.
let diffWorkerPool: WorkerPoolManager | undefined;

function getDiffWorkerPool(themeName: DiffThemeName): WorkerPoolManager {
  if (diffWorkerPool) {
    return diffWorkerPool;
  }
  const cores =
    typeof navigator === "undefined" ? 4 : Math.max(1, navigator.hardwareConcurrency || 4);
  const pool = new WorkerPoolManager(
    {
      workerFactory: () => {
        try {
          return new DiffsWorker();
        } catch (cause) {
          throw new DiffWorkerError({ operation: "create-worker", themeName, cause });
        }
      },
      poolSize: Math.max(2, Math.min(3, Math.floor(cores / 2))),
      // Entry-capped only; @pierre/diffs exposes no byte cap for its AST LRUs.
      totalASTLRUCacheSize: 120,
    },
    {
      theme: themeName,
      tokenizeMaxLineLength: 1_000,
      useTokenTransformer: true,
    },
  );
  // The constructor eagerly boots the pool; cancel that so workers only spawn once
  // a diff actually renders (the manager re-initializes itself on demand).
  pool.terminate();
  pool.subscribeToStatChanges(createDiffWorkerPoolIdleTerminator(pool));
  diffWorkerPool = pool;
  return pool;
}

export function DiffWorkerPoolProvider({ children }: { children?: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const [pool] = useState(() => getDiffWorkerPool(diffThemeName));

  return (
    <WorkerPoolContext.Provider value={pool}>
      <DiffWorkerThemeSync themeName={diffThemeName} />
      {children}
    </WorkerPoolContext.Provider>
  );
}
