import { EMPTY_ENVIRONMENT_THREAD_STATE } from "@t3tools/client-runtime/state/threads";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry } from "../rpc/atomRegistry";

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

  it("copies and unsubscribes when the atom is already live", async () => {
    readThreadDetail.mockReturnValue(null);
    const live = AsyncResult.success({
      data: Option.some({
        messages: [
          { role: "user" as const, text: "Copy is broken" },
          { role: "assistant" as const, text: "I'll fix the flyout." },
        ],
      }),
      status: "live" as const,
      error: Option.none(),
      page: Option.none(),
    });
    const unsubscribe = vi.fn();
    const subscribe = vi
      .spyOn(appAtomRegistry, "subscribe")
      .mockImplementation((_atom, listener, options) => {
        if (options?.immediate === true) {
          listener(live);
        }
        return unsubscribe;
      });

    await expect(
      loadThreadConversationText(
        { environmentId: "env-1" as never, threadId: "thread-1" as never },
        "Fix the menu",
      ),
    ).resolves.toBe("Fix the menu\n\nUser:\nCopy is broken\n\nAssistant:\nI'll fix the flyout.");
    expect(unsubscribe).toHaveBeenCalledOnce();
    subscribe.mockRestore();
  });
});
