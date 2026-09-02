/**
 * Runs asynchronous operations in call order while keeping the queue usable
 * after an individual operation rejects.
 */
export class SerializedAsyncQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * Runs at most one operation at a time and retains only the newest value while
 * that operation is in flight. Useful for presentation caches where writing
 * every intermediate snapshot would grow an unbounded promise chain.
 */
export class LatestOnlyAsyncQueue<T> {
  private active = false;
  private hasPending = false;
  private pending: T | undefined;

  constructor(
    private readonly operation: (value: T) => Promise<unknown>,
    private readonly onError?: (cause: unknown) => void,
  ) {}

  enqueue(value: T): void {
    this.pending = value;
    this.hasPending = true;
    if (!this.active) {
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    this.active = true;
    while (this.hasPending) {
      const value = this.pending as T;
      this.pending = undefined;
      this.hasPending = false;
      try {
        await this.operation(value);
      } catch (cause) {
        try {
          this.onError?.(cause);
        } catch {
          // Error reporting cannot poison future queued work.
        }
      }
    }
    this.active = false;
  }
}
