export const ROW_WRAPPER_SELECTOR = "[data-timeline-root]";
export const WORKING_ROW_SELECTOR = '[data-timeline-row-kind="working"]';
export const PILL_SELECTOR = 'button[aria-label="Scroll to end"]';
export const HERO_SELECTOR = "[data-chat-composer-overlay] h1";
export const SIDEBAR_ICON_SELECTOR = "[data-thread-item] svg.lucide-circle-dashed";

export const SCENERY_MOTION_STRUCTURE_SELECTOR = [
  ROW_WRAPPER_SELECTOR,
  "[data-timeline-row-id]",
  "[data-timeline-row-kind]",
  "[data-approval-detail]",
  PILL_SELECTOR,
  HERO_SELECTOR,
  SIDEBAR_ICON_SELECTOR,
].join(",");

function nodeTouchesSceneryStructure(node: Node): boolean {
  if (node.nodeType !== 1) {
    return false;
  }
  const element = node as Element;
  return (
    element.matches(SCENERY_MOTION_STRUCTURE_SELECTOR) ||
    element.querySelector(SCENERY_MOTION_STRUCTURE_SELECTOR) !== null
  );
}

export function mutationsRequireSceneryMotionSync(
  mutations: ReadonlyArray<MutationRecord>,
): boolean {
  for (const mutation of mutations) {
    if (mutation.type === "attributes") {
      return true;
    }
    for (const node of mutation.addedNodes) {
      if (nodeTouchesSceneryStructure(node)) {
        return true;
      }
    }
    for (const node of mutation.removedNodes) {
      if (nodeTouchesSceneryStructure(node)) {
        return true;
      }
    }
  }
  return false;
}
