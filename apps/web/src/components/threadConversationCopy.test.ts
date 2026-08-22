import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@t3tools/client-runtime/state/threads";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

const { readThreadDetail, stateAtom } = vi.hoisted(() => ({
  readThreadDetail: vi.fn(),
  stateAtom: vi.fn(),
}));

vi.mock("../state/entities", () => ({ readThreadDetail }));
vi.mock("../state/threads", () => ({
  environmentThreads: { stateAtom },
}));

import { formatThreadConversation, loadThreadConversationText } from "./threadConversationCopy";

describe("formatThreadConversation", () => {
  it("joins title with user and assistant turns", () => {
    expect(
      formatThreadConversation("Fix the menu", [
        { role: "user", text: "Copy is broken" },
        { role: "assistant", text: "I'll fix the flyout." },
      ]),
    ).toBe("Fix the menu\n\nUser:\nCopy is broken\n\nAssistant:\nI'll fix the flyout.");
  });

  it("skips system and blank messages", () => {
    expect(
      formatThreadConversation("Thread", [
        { role: "system", text: "hidden" },
        { role: "user", text: "  " },
        { role: "assistant", text: "hello" },
      ]),
    ).toBe("Thread\n\nAssistant:\nhello");
  });

  it("returns an empty string when there is nothing to copy", () => {
    expect(formatThreadConversation("   ", [])).toBe("");
  });
});

describe("loadThreadConversationText", () => {
  it("rejects when thread state stays empty past the timeout", async () => {
    readThreadDetail.mockReturnValue(null);
    stateAtom.mockReturnValue(Atom.make(AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE)));

    await expect(
      loadThreadConversationText(
        { environmentId: "env-1" as never, threadId: "thread-1" as never },
        "Stuck thread",
        20,
      ),
    ).rejects.toThrow("Timed out loading conversation");
  });
});
