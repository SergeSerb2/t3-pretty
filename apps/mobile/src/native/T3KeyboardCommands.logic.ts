import type { HardwareKeyboardCommand } from "../features/keyboard/hardwareKeyboardCommands";

/** Accept only commands the current JS screen explicitly exposed to the native view. */
export function resolveNativeHardwareKeyboardCommand(
  value: unknown,
  enabledCommands: ReadonlyArray<HardwareKeyboardCommand>,
): HardwareKeyboardCommand | null {
  if (typeof value !== "string") return null;
  return enabledCommands.find((command) => command === value) ?? null;
}
