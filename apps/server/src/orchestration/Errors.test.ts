import { describe, expect, it } from "vite-plus/test";

import { OrchestrationCommandInvariantError, isThreadAlreadyExistsInvariant } from "./Errors.ts";

describe("isThreadAlreadyExistsInvariant", () => {
  it("matches a duplicate thread.create invariant", () => {
    expect(
      isThreadAlreadyExistsInvariant(
        new OrchestrationCommandInvariantError({
          commandType: "thread.create",
          detail: "Thread 'thread-1' already exists and cannot be created twice.",
        }),
      ),
    ).toBe(true);
  });

  it("rejects other command invariants", () => {
    expect(
      isThreadAlreadyExistsInvariant(
        new OrchestrationCommandInvariantError({
          commandType: "thread.turn.start",
          detail: "Thread 'thread-1' does not exist for command 'thread.turn.start'.",
        }),
      ),
    ).toBe(false);
    expect(isThreadAlreadyExistsInvariant(new Error("already exists"))).toBe(false);
  });
});
