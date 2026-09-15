import type { DiffsHighlighter } from "@pierre/diffs";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const { getSharedHighlighter } = vi.hoisted(() => ({
  getSharedHighlighter: vi.fn(),
}));

vi.mock("@pierre/diffs", () => ({
  getSharedHighlighter,
}));

import {
  __resetSyntaxHighlighterCacheForTests,
  getSyntaxHighlighterPromise,
} from "./syntaxHighlighting";

beforeEach(() => {
  getSharedHighlighter.mockReset();
  __resetSyntaxHighlighterCacheForTests();
});

it("caches the recovered text highlighter for unsupported languages", async () => {
  const textHighlighter = {} as DiffsHighlighter;
  getSharedHighlighter.mockImplementation(({ langs }: { langs: string[] }) =>
    langs[0] === "text"
      ? Promise.resolve(textHighlighter)
      : Promise.reject(new Error("unsupported language")),
  );

  const first = getSyntaxHighlighterPromise("unsupported-test-language");
  await expect(first).resolves.toBe(textHighlighter);
  const second = getSyntaxHighlighterPromise("unsupported-test-language");

  expect(second).toBe(first);
  expect(getSharedHighlighter).toHaveBeenCalledTimes(2);
});

it("does not permanently cache a failed language promise", async () => {
  getSharedHighlighter.mockRejectedValueOnce(new Error("initialization failed"));

  await expect(getSyntaxHighlighterPromise("text")).rejects.toThrow("initialization failed");

  const highlighter = {} as DiffsHighlighter;
  getSharedHighlighter.mockResolvedValueOnce(highlighter);
  await expect(getSyntaxHighlighterPromise("text")).resolves.toBe(highlighter);
  expect(getSharedHighlighter).toHaveBeenCalledTimes(2);
});
