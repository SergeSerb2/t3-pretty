// @vitest-environment jsdom
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { NativeSyntheticEvent } from "react-native";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { NativeReviewDiffData } from "./nativeReviewDiffAdapter";
import { clearReviewCommentTarget, getReviewCommentTarget } from "./reviewCommentSelection";
import type { ReviewRenderableLineRow, ReviewSectionItem } from "./reviewModel";
import { useReviewCommentSelectionController } from "./useReviewCommentSelectionController";

const navigation = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => navigation }));

const environmentId = EnvironmentId.make("environment-a");
const threadId = ThreadId.make("thread-a");
const section: ReviewSectionItem = {
  id: "working-tree",
  kind: "working-tree",
  title: "Uncommitted",
  subtitle: null,
  diff: null,
  isLoading: false,
};
const lines: ReviewRenderableLineRow[] = Array.from({ length: 4 }, (_, index) => ({
  kind: "line",
  id: `line-${index}`,
  change: "add",
  oldLineNumber: null,
  newLineNumber: index + 1,
  content: `const value${index} = ${index};`,
  additionTokenIndex: index,
  deletionTokenIndex: null,
  comparison: null,
}));
const nativeReviewDiffData: NativeReviewDiffData = {
  rows: [],
  files: [],
  commentTargetsByRowId: new Map(
    lines.map((_, lineIndex) => [`row-${lineIndex}`, { filePath: "app.ts", lines, lineIndex }]),
  ),
  rowIdByCommentLineId: new Map(lines.map((line, index) => [line.id, `row-${index}`])),
  additions: lines.length,
  deletions: 0,
};

let root: Root;
let controller: ReturnType<typeof useReviewCommentSelectionController>;
function Probe(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly data?: NativeReviewDiffData;
}) {
  const selection = useReviewCommentSelectionController({
    ...props,
    selectedSection: section,
    nativeReviewDiffData: props.data ?? nativeReviewDiffData,
  });
  useLayoutEffect(() => {
    controller = selection;
  }, [selection]);
  return null;
}
function render(
  nextEnvironmentId = environmentId,
  nextThreadId = threadId,
  data = nativeReviewDiffData,
) {
  act(() =>
    root.render(<Probe environmentId={nextEnvironmentId} threadId={nextThreadId} data={data} />),
  );
}
function press(index: number, gesture: "tap" | "longPress" = "tap") {
  act(() =>
    controller.onPressLine({
      nativeEvent: { rowId: `row-${index}`, gesture },
    } as NativeSyntheticEvent<{ rowId: string; gesture: "tap" | "longPress" }>),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.navigate.mockClear();
  clearReviewCommentTarget();
  root = createRoot(document.createElement("div"));
  render();
});
afterEach(() => {
  act(() => root.unmount());
  clearReviewCommentTarget();
  vi.unstubAllGlobals();
});

it("starts a new range after replacing an existing range", () => {
  press(0, "longPress");
  press(1);
  expect(getReviewCommentTarget()).toMatchObject({ startIndex: 0, endIndex: 1 });

  press(2, "longPress");
  expect(controller.selectedRowIds).toEqual(["row-2"]);
  expect(controller.selectionAction?.title).toBe("Select range end");
  press(3);
  expect(getReviewCommentTarget()).toMatchObject({ startIndex: 2, endIndex: 3 });
  expect(navigation.navigate).not.toHaveBeenCalled();
});

it.each(["thread", "environment"])("clears a range when the %s changes", (changed) => {
  press(0, "longPress");
  press(1);
  render(
    changed === "environment" ? EnvironmentId.make("environment-b") : environmentId,
    changed === "thread" ? ThreadId.make("thread-b") : threadId,
  );
  expect(getReviewCommentTarget()).toBeNull();
  expect(controller.selectedRowIds).toEqual([]);
  expect(controller.selectionAction).toBeNull();
});

it("does not reuse a range anchor after the comment sheet is dismissed", () => {
  press(0, "longPress");
  press(1);
  act(() => clearReviewCommentTarget());
  press(3);
  expect(getReviewCommentTarget()).toMatchObject({ startIndex: 3, endIndex: 3 });
  expect(navigation.navigate).toHaveBeenCalledWith("ThreadReviewComment", {
    environmentId,
    threadId,
  });
});

it("does not combine a range anchor with lines from a refreshed file", () => {
  press(0, "longPress");
  const refreshedLines = lines.map((line) => ({ ...line, content: `${line.content} // updated` }));
  const refreshedData: NativeReviewDiffData = {
    ...nativeReviewDiffData,
    commentTargetsByRowId: new Map(
      refreshedLines.map((_, lineIndex) => [
        `row-${lineIndex}`,
        { filePath: "app.ts", lines: refreshedLines, lineIndex },
      ]),
    ),
  };

  render(environmentId, threadId, refreshedData);

  expect(controller.selectedRowIds).toEqual([]);
  expect(controller.selectionAction).toBeNull();
  press(3);
  expect(getReviewCommentTarget()).toMatchObject({ startIndex: 3, endIndex: 3 });
  expect(getReviewCommentTarget()?.lines).toBe(refreshedLines);
  expect(navigation.navigate).toHaveBeenCalledWith("ThreadReviewComment", {
    environmentId,
    threadId,
  });
});

it("retains a range anchor when another file loads without changing its lines", () => {
  press(0, "longPress");
  const additionalFileLines = lines.map((line) => ({ ...line, id: `other:${line.id}` }));
  render(environmentId, threadId, {
    ...nativeReviewDiffData,
    commentTargetsByRowId: new Map([
      ...nativeReviewDiffData.commentTargetsByRowId,
      ["other-row", { filePath: "other.ts", lines: additionalFileLines, lineIndex: 0 }],
    ]),
  });

  expect(controller.selectedRowIds).toEqual(["row-0"]);
  press(3);
  expect(getReviewCommentTarget()).toMatchObject({ startIndex: 0, endIndex: 3 });
  expect(getReviewCommentTarget()?.lines).toBe(lines);
  expect(navigation.navigate).not.toHaveBeenCalled();
});
