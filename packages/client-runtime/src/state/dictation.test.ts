import { describe, expect, it } from "@effect/vitest";

import {
  appendDictationHypothesis,
  appendDictationSegment,
  finishDictationText,
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

describe("append-only dictation hypotheses", () => {
  it("grows when the next hypothesis extends the text already shown", () => {
    const first = appendDictationHypothesis("", "hello");
    const second = appendDictationHypothesis(first, "hello there");
    expect(appendDictationHypothesis(second, "hello there friend")).toBe("hello there friend");
  });

  it("keeps the beginning when the engine slides forward to a later window", () => {
    expect(
      appendDictationHypothesis("I need to update the sidebar", "update the sidebar padding"),
    ).toBe("I need to update the sidebar padding");
  });

  it("keeps earlier words when a new hypothesis rewrites them", () => {
    expect(
      appendDictationHypothesis(
        "I need to update the sidebar tonight",
        "Can you update the sidebar tonight now",
      ),
    ).toBe("I need to update the sidebar tonight now");
  });

  it("revises only the words still being recognized", () => {
    expect(
      appendDictationHypothesis(
        "please update the sidebar tonight",
        "please update the sidebar tomorrow",
      ),
    ).toBe("please update the sidebar tomorrow");
  });

  it("ignores a shorter restatement of words already shown", () => {
    expect(appendDictationHypothesis("hello there friend", "hello there")).toBe(
      "hello there friend",
    );
  });

  it("appends a later phrase that does not overlap", () => {
    expect(appendDictationHypothesis("first thought", "padding only")).toBe(
      "first thought padding only",
    );
  });
});

describe("dictation cleanup", () => {
  it("drops an immediate repeated phrase and keeps punctuation from the final hypothesis", () => {
    expect(
      finishDictationText("go to the store go to the store tomorrow", "go to the store tomorrow."),
    ).toBe("go to the store tomorrow.");
  });

  it("does not replace the dictated text with a short trailing window", () => {
    expect(
      finishDictationText(
        "I need to update the sidebar padding tonight please",
        "padding tonight please",
      ),
    ).toBe("I need to update the sidebar padding tonight please");
  });
});
