import type { ContextMenuItem } from "@t3tools/contracts";

export type EditContextMenuActionId =
  | `spellcheck:${number}`
  | "spellcheck-none"
  | "sep-spellcheck"
  | "copy-link"
  | "sep-link"
  | "copy-image"
  | "sep-image"
  | "cut"
  | "copy"
  | "paste"
  | "select-all";

export interface EditContextMenuParams {
  readonly isEditable: boolean;
  readonly misspelledWord: string;
  readonly dictionarySuggestions: readonly string[];
  readonly hasSafeLink: boolean;
  readonly mediaType: string;
  readonly canCut: boolean;
  readonly canCopy: boolean;
  readonly canPaste: boolean;
  readonly canSelectAll: boolean;
}

export type EditContextMenuCommand =
  | { readonly type: "replace-misspelling"; readonly suggestion: string }
  | { readonly type: "copy-link" }
  | { readonly type: "copy-image" }
  | { readonly type: "cut" }
  | { readonly type: "copy" }
  | { readonly type: "paste" }
  | { readonly type: "select-all" };

const MAX_SPELLCHECK_SUGGESTIONS = 5;

export function shouldOfferEditContextMenu(params: {
  readonly isEditable: boolean;
  readonly misspelledWord: string;
  readonly hasSafeLink: boolean;
  readonly mediaType: string;
}): boolean {
  return (
    params.isEditable ||
    params.misspelledWord.length > 0 ||
    params.hasSafeLink ||
    params.mediaType === "image"
  );
}

export function buildEditContextMenuItems(
  params: EditContextMenuParams,
): ContextMenuItem<EditContextMenuActionId>[] {
  const items: ContextMenuItem<EditContextMenuActionId>[] = [];

  if (params.misspelledWord.length > 0) {
    const suggestions = params.dictionarySuggestions.slice(0, MAX_SPELLCHECK_SUGGESTIONS);
    if (suggestions.length === 0) {
      items.push({ id: "spellcheck-none", label: "No suggestions", disabled: true });
    } else {
      for (const [index, suggestion] of suggestions.entries()) {
        items.push({ id: `spellcheck:${index}`, label: suggestion });
      }
    }
    items.push({ id: "sep-spellcheck", label: "", separator: true });
  }

  if (params.hasSafeLink) {
    items.push({ id: "copy-link", label: "Copy Link", icon: "link" });
    items.push({ id: "sep-link", label: "", separator: true });
  }

  if (params.mediaType === "image") {
    items.push({ id: "copy-image", label: "Copy Image", icon: "image" });
    items.push({ id: "sep-image", label: "", separator: true });
  }

  items.push(
    { id: "cut", label: "Cut", icon: "scissors", disabled: !params.canCut },
    { id: "copy", label: "Copy", icon: "copy", disabled: !params.canCopy },
    { id: "paste", label: "Paste", icon: "clipboard-paste", disabled: !params.canPaste },
    { id: "select-all", label: "Select All", icon: "text-select", disabled: !params.canSelectAll },
  );

  return items;
}

export function resolveEditContextMenuCommand(input: {
  readonly actionId: string | null;
  readonly dictionarySuggestions: readonly string[];
}): EditContextMenuCommand | null {
  const actionId = input.actionId;
  if (actionId === null) return null;
  if (actionId.startsWith("spellcheck:")) {
    const index = Number(actionId.slice("spellcheck:".length));
    const suggestion = input.dictionarySuggestions[index];
    if (typeof suggestion !== "string" || suggestion.length === 0) return null;
    return { type: "replace-misspelling", suggestion };
  }
  switch (actionId) {
    case "copy-link":
      return { type: "copy-link" };
    case "copy-image":
      return { type: "copy-image" };
    case "cut":
      return { type: "cut" };
    case "copy":
      return { type: "copy" };
    case "paste":
      return { type: "paste" };
    case "select-all":
      return { type: "select-all" };
    default:
      return null;
  }
}

const pendingEditMenus = new Map<string, (itemId: string | null) => void>();
let nextEditContextMenuRequestId = 0;

export function nextEditContextMenuRequestIdValue(): string {
  nextEditContextMenuRequestId += 1;
  return `edit-context-menu-${nextEditContextMenuRequestId}`;
}

export function registerEditContextMenuWaiter(
  requestId: string,
  resolve: (itemId: string | null) => void,
): void {
  pendingEditMenus.get(requestId)?.(null);
  pendingEditMenus.set(requestId, resolve);
}

export function completeEditContextMenuRequest(requestId: string, itemId: string | null): boolean {
  const resolve = pendingEditMenus.get(requestId);
  if (!resolve) return false;
  pendingEditMenus.delete(requestId);
  resolve(itemId);
  return true;
}

export function resetEditContextMenuWaitersForTests(): void {
  for (const resolve of pendingEditMenus.values()) {
    resolve(null);
  }
  pendingEditMenus.clear();
  nextEditContextMenuRequestId = 0;
}
