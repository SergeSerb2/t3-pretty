import { describe, expect, it } from "vite-plus/test";

import { resolveNativeHardwareKeyboardCommand } from "./T3KeyboardCommands.logic";

describe("resolveNativeHardwareKeyboardCommand", () => {
  it("accepts a command that the current screen enabled", () => {
    expect(resolveNativeHardwareKeyboardCommand("newTask", ["newTask", "back"])).toBe("newTask");
  });

  it("rejects known commands that are not enabled for the current screen", () => {
    expect(resolveNativeHardwareKeyboardCommand("terminal", ["newTask", "back"])).toBeNull();
  });

  it("rejects malformed native payload values", () => {
    expect(resolveNativeHardwareKeyboardCommand("unknown", ["newTask"])).toBeNull();
    expect(resolveNativeHardwareKeyboardCommand(null, ["newTask"])).toBeNull();
    expect(resolveNativeHardwareKeyboardCommand({ command: "newTask" }, ["newTask"])).toBeNull();
  });
});
