import { describe, expect, it, vi } from "@effect/vitest";

import { LatestOnlyAsyncQueue, SerializedAsyncQueue } from "./serialized-async-queue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("SerializedAsyncQueue", () => {
  it("does not let a newer operation overtake an in-flight operation", async () => {
    const queue = new SerializedAsyncQueue();
    const firstGate = deferred();
    const events: string[] = [];

    const first = queue.run(async () => {
      events.push("first:start");
      await firstGate.promise;
      events.push("first:end");
    });
    const second = queue.run(async () => {
      events.push("second");
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    firstGate.resolve();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second"]);
  });

  it("continues after a rejected operation", async () => {
    const queue = new SerializedAsyncQueue();
    const first = queue.run(async () => {
      throw new Error("failed");
    });
    const second = queue.run(async () => "recovered");

    await expect(first).rejects.toThrow("failed");
    await expect(second).resolves.toBe("recovered");
  });
});

describe("LatestOnlyAsyncQueue", () => {
  it("coalesces pending snapshots behind an in-flight operation", async () => {
    const firstGate = deferred();
    const started: number[] = [];
    const completed: number[] = [];
    const queue = new LatestOnlyAsyncQueue<number>(async (value) => {
      started.push(value);
      if (value === 1) {
        await firstGate.promise;
      }
      completed.push(value);
    });

    queue.enqueue(1);
    queue.enqueue(2);
    queue.enqueue(3);
    await Promise.resolve();
    expect(started).toEqual([1]);

    firstGate.resolve();
    await vi.waitFor(() => expect(completed).toEqual([1, 3]));
    expect(started).toEqual([1, 3]);
  });

  it("continues after an operation rejects", async () => {
    const failures: unknown[] = [];
    const completed: number[] = [];
    const queue = new LatestOnlyAsyncQueue<number>(async (value) => {
      if (value === 1) throw new Error("failed");
      completed.push(value);
    }, failures.push.bind(failures));

    queue.enqueue(1);
    await vi.waitFor(() => expect(failures).toHaveLength(1));
    queue.enqueue(2);
    await vi.waitFor(() => expect(completed).toEqual([2]));
  });
});
