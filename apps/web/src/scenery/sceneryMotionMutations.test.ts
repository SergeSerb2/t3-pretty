import { describe, expect, it } from "vite-plus/test";

import {
  mutationsRequireSceneryMotionSync,
  SCENERY_MOTION_STRUCTURE_SELECTOR,
} from "./sceneryMotionMutations";

function elementNode(options: { matches?: boolean; contains?: boolean } = {}) {
  return {
    nodeType: 1,
    matches: () => options.matches ?? false,
    querySelector: () => (options.contains ? {} : null),
  } as unknown as Node;
}

function mutation(
  type: MutationRecord["type"],
  options: { added?: Node[]; removed?: Node[] } = {},
) {
  return {
    type,
    addedNodes: options.added ?? [],
    removedNodes: options.removed ?? [],
  } as unknown as MutationRecord;
}

describe("scenery motion mutation filter", () => {
  it("covers every structural portal and row target", () => {
    expect(SCENERY_MOTION_STRUCTURE_SELECTOR).toContain("[data-timeline-root]");
    expect(SCENERY_MOTION_STRUCTURE_SELECTOR).toContain("[data-timeline-row-id]");
    expect(SCENERY_MOTION_STRUCTURE_SELECTOR).toContain("[data-timeline-row-kind]");
    expect(SCENERY_MOTION_STRUCTURE_SELECTOR).toContain("[data-approval-detail]");
    expect(SCENERY_MOTION_STRUCTURE_SELECTOR).toContain('button[aria-label="Scroll to end"]');
    expect(SCENERY_MOTION_STRUCTURE_SELECTOR).toContain("[data-chat-composer-overlay] h1");
    expect(SCENERY_MOTION_STRUCTURE_SELECTOR).not.toContain("svg.lucide-circle-dashed");
  });

  it("ignores streamed text and unrelated element churn", () => {
    const textNode = { nodeType: 3 } as Node;
    expect(
      mutationsRequireSceneryMotionSync([
        mutation("childList", { added: [textNode, elementNode()] }),
      ]),
    ).toBe(false);
  });

  it("accepts observed timeline attribute changes", () => {
    expect(mutationsRequireSceneryMotionSync([mutation("attributes")])).toBe(true);
  });

  it("accepts added or removed motion targets and containing subtrees", () => {
    expect(
      mutationsRequireSceneryMotionSync([
        mutation("childList", { added: [elementNode({ matches: true })] }),
      ]),
    ).toBe(true);
    expect(
      mutationsRequireSceneryMotionSync([
        mutation("childList", { removed: [elementNode({ contains: true })] }),
      ]),
    ).toBe(true);
  });
});
