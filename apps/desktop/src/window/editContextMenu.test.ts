import { describe, expect, it } from "vite-plus/test";

import {
  buildEditContextMenuItems,
  completeEditContextMenuRequest,
  registerEditContextMenuWaiter,
  resetEditContextMenuWaitersForTests,
  resolveEditContextMenuCommand,
  shouldOfferEditContextMenu,
  type EditContextMenuParams,
} from "./editContextMenu.ts";

const editable: EditContextMenuParams = {
  isEditable: true,
  misspelledWord: "",
  dictionarySuggestions: [],
  hasSafeLink: false,
  mediaType: "none",
  canCut: true,
  canCopy: true,
  canPaste: true,
  canSelectAll: true,
};

describe("shouldOfferEditContextMenu", () => {
  it("skips generic page right-clicks so authored menus own the gesture", () => {
    expect(
      shouldOfferEditContextMenu({
        isEditable: false,
        misspelledWord: "",
        hasSafeLink: false,
        mediaType: "none",
      }),
    ).toBe(false);
  });

  it("offers the menu for inputs, misspellings, links, and images", () => {
    expect(
      shouldOfferEditContextMenu({
        isEditable: true,
        misspelledWord: "",
        hasSafeLink: false,
        mediaType: "none",
      }),
    ).toBe(true);
    expect(
      shouldOfferEditContextMenu({
        isEditable: false,
        misspelledWord: "teh",
        hasSafeLink: false,
        mediaType: "none",
      }),
    ).toBe(true);
    expect(
      shouldOfferEditContextMenu({
        isEditable: false,
        misspelledWord: "",
        hasSafeLink: true,
        mediaType: "none",
      }),
    ).toBe(true);
    expect(
      shouldOfferEditContextMenu({
        isEditable: false,
        misspelledWord: "",
        hasSafeLink: false,
        mediaType: "image",
      }),
    ).toBe(true);
  });
});

describe("buildEditContextMenuItems", () => {
  it("always includes cut/copy/paste/select all", () => {
    expect(buildEditContextMenuItems(editable).map((item) => item.id)).toEqual([
      "cut",
      "copy",
      "paste",
      "select-all",
    ]);
  });

  it("prepends spellcheck suggestions and a separator", () => {
    const items = buildEditContextMenuItems({
      ...editable,
      misspelledWord: "teh",
      dictionarySuggestions: ["the", "tea"],
    });
    expect(items.map((item) => item.id)).toEqual([
      "spellcheck:0",
      "spellcheck:1",
      "sep-spellcheck",
      "cut",
      "copy",
      "paste",
      "select-all",
    ]);
    expect(items[0]).toMatchObject({ label: "the" });
  });

  it("caps suggestions at five and disables the empty state", () => {
    const many = buildEditContextMenuItems({
      ...editable,
      misspelledWord: "teh",
      dictionarySuggestions: ["a", "b", "c", "d", "e", "f"],
    });
    expect(many.filter((item) => item.id.startsWith("spellcheck:")).map((item) => item.id)).toEqual(
      ["spellcheck:0", "spellcheck:1", "spellcheck:2", "spellcheck:3", "spellcheck:4"],
    );

    const empty = buildEditContextMenuItems({
      ...editable,
      misspelledWord: "teh",
      dictionarySuggestions: [],
    });
    expect(empty[0]).toMatchObject({ id: "spellcheck-none", disabled: true });
  });

  it("inserts copy-link and copy-image before the edit actions", () => {
    const items = buildEditContextMenuItems({
      ...editable,
      hasSafeLink: true,
      mediaType: "image",
    });
    expect(items.map((item) => item.id)).toEqual([
      "copy-link",
      "sep-link",
      "copy-image",
      "sep-image",
      "cut",
      "copy",
      "paste",
      "select-all",
    ]);
  });
});

describe("resolveEditContextMenuCommand", () => {
  const suggestions = ["the", "tea"];

  it("maps spellcheck ids onto suggestions", () => {
    expect(
      resolveEditContextMenuCommand({
        actionId: "spellcheck:1",
        dictionarySuggestions: suggestions,
      }),
    ).toEqual({
      type: "replace-misspelling",
      suggestion: "tea",
    });
    expect(
      resolveEditContextMenuCommand({
        actionId: "spellcheck:9",
        dictionarySuggestions: suggestions,
      }),
    ).toBeNull();
  });

  it("maps edit actions", () => {
    expect(resolveEditContextMenuCommand({ actionId: "cut", dictionarySuggestions: [] })).toEqual({
      type: "cut",
    });
    expect(
      resolveEditContextMenuCommand({ actionId: "copy-link", dictionarySuggestions: [] }),
    ).toEqual({
      type: "copy-link",
    });
    expect(resolveEditContextMenuCommand({ actionId: null, dictionarySuggestions: [] })).toBeNull();
  });
});

describe("edit context menu waiters", () => {
  it("resolves the matching request and ignores stale ids", () => {
    resetEditContextMenuWaitersForTests();
    let selected: string | null | undefined = undefined;
    registerEditContextMenuWaiter("req-1", (itemId) => {
      selected = itemId;
    });
    expect(completeEditContextMenuRequest("missing", "copy")).toBe(false);
    expect(completeEditContextMenuRequest("req-1", "paste")).toBe(true);
    expect(selected).toBe("paste");
    expect(completeEditContextMenuRequest("req-1", "cut")).toBe(false);
  });
});
