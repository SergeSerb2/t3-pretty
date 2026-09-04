export type SettingsEscapeAction = "ignore" | "blur" | "navigate";

const SETTINGS_ESCAPE_OWNED_SURFACE_SELECTOR =
  '[role="dialog"], [aria-modal="true"], [data-slot$="popup"]';

export function settingsEscapeAction(activeElement: Element | null): SettingsEscapeAction {
  if (activeElement === null) return "navigate";
  if (activeElement.closest(SETTINGS_ESCAPE_OWNED_SURFACE_SELECTOR)) return "ignore";
  if (
    activeElement.tagName === "INPUT" ||
    activeElement.tagName === "TEXTAREA" ||
    activeElement.tagName === "SELECT" ||
    (activeElement as HTMLElement).isContentEditable
  ) {
    return "blur";
  }
  return "navigate";
}
