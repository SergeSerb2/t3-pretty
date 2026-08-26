import { requireNativeView } from "expo";
import type { PropsWithChildren } from "react";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

import type { HardwareKeyboardCommand } from "../features/keyboard/hardwareKeyboardCommands";
import { resolveNativeHardwareKeyboardCommand } from "./T3KeyboardCommands.logic";

interface NativeKeyboardCommandsProps extends ViewProps, PropsWithChildren {
  readonly enabledCommands: ReadonlyArray<HardwareKeyboardCommand>;
  readonly onCommand: (event: NativeSyntheticEvent<{ readonly command?: unknown }>) => void;
}

const NativeKeyboardCommands = requireNativeView<NativeKeyboardCommandsProps>("T3KeyboardCommands");

export function T3KeyboardCommands(
  props: PropsWithChildren<{
    readonly enabledCommands: ReadonlyArray<HardwareKeyboardCommand>;
    readonly onCommand: (command: HardwareKeyboardCommand) => void;
  }>,
) {
  return (
    <NativeKeyboardCommands
      onCommand={(event) => {
        const command = resolveNativeHardwareKeyboardCommand(
          event.nativeEvent.command,
          props.enabledCommands,
        );
        if (command !== null) {
          props.onCommand(command);
        }
      }}
      enabledCommands={props.enabledCommands}
      style={{ flex: 1 }}
    >
      {props.children}
    </NativeKeyboardCommands>
  );
}
