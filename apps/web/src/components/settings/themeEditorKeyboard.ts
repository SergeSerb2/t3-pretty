const NESTED_THEME_EDITOR_SURFACE_SELECTOR = [
  '[data-slot="popover-popup"]',
  '[data-slot="dialog-popup"]',
  '[data-slot="alert-dialog-popup"]',
  '[data-slot="command-dialog-popup"]',
  '[data-slot="menu-popup"]',
  '[data-slot="select-popup"]',
  '[data-slot="combobox-popup"]',
  '[data-slot="autocomplete-popup"]',
].join(",");

export function shouldCloseThemeEditorOnKeyDown(
  event: Pick<KeyboardEvent, "defaultPrevented" | "isComposing" | "key" | "target">,
): boolean {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return false;
  return !(
    event.target instanceof Element && event.target.closest(NESTED_THEME_EDITOR_SURFACE_SELECTOR)
  );
}
