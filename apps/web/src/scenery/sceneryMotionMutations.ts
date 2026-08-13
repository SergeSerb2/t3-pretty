export const ROW_WRAPPER_SELECTOR = "[data-timeline-root]";

export const SCENERY_MOTION_STRUCTURE_SELECTOR = [
  ROW_WRAPPER_SELECTOR,
  "[data-timeline-row-id]",
  "[data-timeline-row-kind]",
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
