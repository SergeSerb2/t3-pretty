import { assert, it } from "@effect/vitest";

import { MAX_TERM_LENGTH, rankedSearchTerms, termFrequencies, tokenize } from "./tokenizer.ts";

it("tokenizes on unicode letters and numbers, lowercased", () => {
  assert.deepEqual(tokenize("Fix the TypeError in Cédric's code"), [
    "fix",
    "the",
    "typeerror",
    "in",
    "cédric",
    "code",
  ]);
});

it("drops single-character tokens", () => {
  assert.deepEqual(tokenize("a b 1 ok"), ["ok"]);
});

it("truncates overlong tokens", () => {
  const tokens = tokenize("x".repeat(MAX_TERM_LENGTH + 20));
  assert.deepEqual(tokens, ["x".repeat(MAX_TERM_LENGTH)]);
});

it("returns an empty array for punctuation-only text", () => {
  assert.deepEqual(tokenize("?! … --"), []);
});

it("counts term frequencies", () => {
  assert.deepEqual(
    termFrequencies("ship the search ship the ship"),
    new Map([
      ["ship", 3],
      ["the", 2],
      ["search", 1],
    ]),
  );
});

it("classifies the final query token as the prefix", () => {
  assert.deepEqual(rankedSearchTerms("ranked search"), {
    exact: ["ranked"],
    prefix: "search",
  });
});

it("treats a single-token query as all prefix", () => {
  assert.deepEqual(rankedSearchTerms("search"), { exact: [], prefix: "search" });
});

it("dedupes repeated query tokens", () => {
  assert.deepEqual(rankedSearchTerms("search search"), { exact: [], prefix: "search" });
});

it("returns null when the query has no indexable tokens", () => {
  assert.strictEqual(rankedSearchTerms("? !!"), null);
  assert.strictEqual(rankedSearchTerms("a b"), null);
});
