import type { ColorValue } from "react-native";
import { useCSSVariable } from "uniwind";

/** Returns a semantic Uniwind color token for imperative native style props. */
export function useThemeColor(variable: `--color-${string}`): ColorValue {
  return useCSSVariable(variable) as string as ColorValue;
}
