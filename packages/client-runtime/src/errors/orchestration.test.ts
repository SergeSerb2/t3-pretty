import { OrchestrationDispatchCommandError } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  isThreadAlreadyExistsError,
  isThreadAlreadyExistsErrorMessage,
  wasBootstrapThreadDeleted,
} from "./orchestration.ts";

const ALREADY_EXISTS_MESSAGE =
  "Orchestration command invariant failed (thread.create): Thread '270a0067-dbb0-4cfb-88e6-f2c2634e7956' already exists and cannot be created twice.";

describe("isThreadAlreadyExistsErrorMessage", () => {
  it("matches the server invariant", () => {
    expect(isThreadAlreadyExistsErrorMessage(ALREADY_EXISTS_MESSAGE)).toBe(true);
  });

  it("rejects other orchestration failures", () => {
    expect(
      isThreadAlreadyExistsErrorMessage(
        "Orchestration command invariant failed (thread.turn.start): Thread 'x' does not exist for command 'thread.turn.start'.",
      ),
    ).toBe(false);
    expect(isThreadAlreadyExistsErrorMessage("Failed to send message.")).toBe(false);
    expect(isThreadAlreadyExistsErrorMessage(null)).toBe(false);
  });
});

describe("isThreadAlreadyExistsError", () => {
  it("reads the message from errors and tagged RPC failures", () => {
    expect(isThreadAlreadyExistsError(new Error(ALREADY_EXISTS_MESSAGE))).toBe(true);
    expect(isThreadAlreadyExistsError({ message: ALREADY_EXISTS_MESSAGE })).toBe(true);
    expect(isThreadAlreadyExistsError(ALREADY_EXISTS_MESSAGE)).toBe(true);
    expect(isThreadAlreadyExistsError(new Error("Failed to send message."))).toBe(false);
  });
});

describe("wasBootstrapThreadDeleted", () => {
  it("accepts only a confirmed deleted bootstrap thread", () => {
    expect(
      wasBootstrapThreadDeleted(
        new OrchestrationDispatchCommandError({
          message: "Failed to create worktree.",
          bootstrapThreadDisposition: "deleted",
        }),
      ),
    ).toBe(true);
    expect(
      wasBootstrapThreadDeleted(
        new OrchestrationDispatchCommandError({ message: "Failed to create worktree." }),
      ),
    ).toBe(false);
    expect(wasBootstrapThreadDeleted(new Error("connection lost"))).toBe(false);
  });
});
