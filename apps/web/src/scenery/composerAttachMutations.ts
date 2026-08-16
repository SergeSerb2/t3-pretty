export const COMPOSER_ATTACH_STRUCTURE_SELECTOR = [
  '[data-chat-composer-actions="right"]',
  '[data-chat-composer-editor-chrome="true"]',
].join(",");

function nodeTouchesComposerAttach(node: Node): boolean {
  if (node.nodeType !== 1) return false;
  const element = node as Element;
  return (
    element.matches(COMPOSER_ATTACH_STRUCTURE_SELECTOR) ||
    element.querySelector(COMPOSER_ATTACH_STRUCTURE_SELECTOR) !== null
  );
}

export function mutationsRequireComposerAttachSync(
  mutations: ReadonlyArray<MutationRecord>,
): boolean {
  for (const mutation of mutations) {
    if (mutation.type !== "childList") continue;
    if (
      mutation.target.nodeType === 1 &&
      (mutation.target as Element).matches(COMPOSER_ATTACH_STRUCTURE_SELECTOR)
    ) {
      return true;
    }
    for (const node of mutation.addedNodes) {
      if (nodeTouchesComposerAttach(node)) return true;
    }
    for (const node of mutation.removedNodes) {
      if (nodeTouchesComposerAttach(node)) return true;
    }
  }
  return false;
}
