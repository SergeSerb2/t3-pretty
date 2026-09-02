import { expect, it } from "vite-plus/test";

import { shouldCloseThemeEditorOnKeyDown } from "./themeEditorKeyboard";

function keyboardEvent(target: EventTarget, overrides?: Partial<KeyboardEvent>) {
  return {
    key: "Escape",
    defaultPrevented: false,
    isComposing: false,
    target,
    ...overrides,
  } as Pick<KeyboardEvent, "defaultPrevented" | "isComposing" | "key" | "target">;
}

it("closes the floating theme editor for an unhandled Escape", () => {
  expect(shouldCloseThemeEditorOnKeyDown(keyboardEvent(document.createElement("input")))).toBe(
    true,
  );
});

it("leaves Escape to a nested popup before closing the editor", () => {
  const popup = document.createElement("div");
  popup.dataset.slot = "popover-popup";
  const input = document.createElement("input");
  popup.append(input);

  expect(shouldCloseThemeEditorOnKeyDown(keyboardEvent(input))).toBe(false);
  expect(shouldCloseThemeEditorOnKeyDown(keyboardEvent(input, { defaultPrevented: true }))).toBe(
    false,
  );
  expect(shouldCloseThemeEditorOnKeyDown(keyboardEvent(input, { isComposing: true }))).toBe(false);
});

it("recognizes every nested input and menu surface", () => {
  for (const slot of ["menu-popup", "select-popup", "combobox-popup", "autocomplete-popup"]) {
    const popup = document.createElement("div");
    popup.dataset.slot = slot;
    const input = document.createElement("input");
    popup.append(input);

    expect(shouldCloseThemeEditorOnKeyDown(keyboardEvent(input))).toBe(false);
  }
});
