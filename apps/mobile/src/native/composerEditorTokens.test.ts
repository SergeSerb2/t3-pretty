import { describe, expect, it } from "@effect/vitest";

import {
  collectNativeComposerInlineTokens,
  NATIVE_COMPOSER_INLINE_TOKEN_MAX_COUNT,
} from "./composerEditorTokens";

describe("collectNativeComposerInlineTokens", () => {
  it("retains ordinary inline tokens", () => {
    expect(collectNativeComposerInlineTokens("Use $ui and @README.md ")).toHaveLength(2);
  });

  it("bounds the number of native chip attachments without changing source text", () => {
    const text = Array.from(
      { length: NATIVE_COMPOSER_INLINE_TOKEN_MAX_COUNT + 32 },
      (_, index) => `$skill${index} `,
    ).join("");

    const tokens = collectNativeComposerInlineTokens(text);

    expect(tokens).toHaveLength(NATIVE_COMPOSER_INLINE_TOKEN_MAX_COUNT);
    expect(tokens[0]?.source).toBe("$skill0");
    expect(tokens.at(-1)?.source).toBe(`$skill${NATIVE_COMPOSER_INLINE_TOKEN_MAX_COUNT - 1}`);
  });
});
