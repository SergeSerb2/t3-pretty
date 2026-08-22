import { describe, expect, it } from "vite-plus/test";

import { formatThreadConversation } from "./threadConversationCopy";

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
