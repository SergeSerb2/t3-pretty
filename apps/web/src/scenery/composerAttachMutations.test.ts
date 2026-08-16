import { describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_ATTACH_STRUCTURE_SELECTOR,
  mutationsRequireComposerAttachSync,
} from "./composerAttachMutations";

function elementNode(options: { matches?: boolean; contains?: boolean } = {}) {
  return {
    nodeType: 1,
    matches: () => options.matches ?? false,
    querySelector: () => (options.contains ? {} : null),
  } as unknown as Node;
}

function mutation(
  type: MutationRecord["type"],
  options: { added?: Node[]; removed?: Node[]; target?: Node } = {},
) {
  return {
    type,
    target: options.target ?? elementNode(),
    addedNodes: options.added ?? [],
    removedNodes: options.removed ?? [],
  } as unknown as MutationRecord;
}

describe("composer attach mutation filter", () => {
  it("covers the composer attach hosts", () => {
    expect(COMPOSER_ATTACH_STRUCTURE_SELECTOR).toContain('[data-chat-composer-actions="right"]');
    expect(COMPOSER_ATTACH_STRUCTURE_SELECTOR).toContain(
      '[data-chat-composer-editor-chrome="true"]',
    );
    expect(COMPOSER_ATTACH_STRUCTURE_SELECTOR).not.toContain("[data-timeline-root]");
    expect(COMPOSER_ATTACH_STRUCTURE_SELECTOR).not.toContain("[data-approval-detail]");
  });

  it("ignores streamed text and unrelated element churn", () => {
    const textNode = { nodeType: 3 } as Node;
    expect(
      mutationsRequireComposerAttachSync([
        mutation("childList", { added: [textNode, elementNode()] }),
      ]),
    ).toBe(false);
  });

  it("ignores attribute mutations", () => {
    expect(mutationsRequireComposerAttachSync([mutation("attributes")])).toBe(false);
  });

  it("accepts added or removed attach hosts and containing subtrees", () => {
    expect(
      mutationsRequireComposerAttachSync([
        mutation("childList", { added: [elementNode({ matches: true })] }),
      ]),
    ).toBe(true);
    expect(
      mutationsRequireComposerAttachSync([
        mutation("childList", { removed: [elementNode({ contains: true })] }),
      ]),
    ).toBe(true);
  });

  it("accepts childList mutations whose target is an attach host", () => {
    expect(
      mutationsRequireComposerAttachSync([
        mutation("childList", { target: elementNode({ matches: true }) }),
      ]),
    ).toBe(true);
  });
});
