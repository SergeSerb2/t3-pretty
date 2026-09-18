import { describe, expect, it } from "@effect/vitest";

import {
  appendDictationSegment,
  formatDictationInsertion,
  replaceDictationInsertion,
} from "./dictation.ts";

describe("dictation composer insertion", () => {
  it("joins chunks and preserves surrounding word boundaries", () => {
    const transcript = appendDictationSegment("first thought", "  second thought  ");
    const insertion = formatDictationInsertion({
      before: "Please",
      after: "today.",
      transcript,
    });

    expect(insertion).toBe(" first thought second thought ");
    expect(
      replaceDictationInsertion({
        value: "Pleasetoday.",
        start: 6,
        before: "Please",
        after: "today.",
        previous: "",
        next: insertion,
      }),
    ).toEqual({ value: "Please first thought second thought today.", cursor: 36 });
  });

  it("refuses to overwrite composer text that changed during dictation", () => {
    expect(
      replaceDictationInsertion({
        value: "edited elsewhere",
        start: 0,
        before: "",
        after: "",
        previous: "old transcript",
        next: "new transcript",
      }),
    ).toBeNull();
  });

  it("refuses the first insertion after the surrounding composer text changed", () => {
    expect(
      replaceDictationInsertion({
        value: "replaced prompt",
        start: 6,
        before: "Please",
        after: "today.",
        previous: "",
        next: " dictated text ",
      }),
    ).toBeNull();
  });
});
