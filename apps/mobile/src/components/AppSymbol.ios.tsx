import { SymbolView as ExpoSymbolView, type SymbolViewProps } from "expo-symbols";
import { withUniwind } from "uniwind";

export type { SFSymbol } from "expo-symbols";
export type AppSymbolName = SymbolViewProps["name"];
export type AppSymbolViewProps = SymbolViewProps;

/**
 * Keep the iOS implementation isolated from the Android Tabler fallback so
 * Metro does not initialize the icon package when iOS renders SF Symbols.
 */
function AppSymbolView(props: AppSymbolViewProps) {
  return <ExpoSymbolView {...props} />;
}

export const SymbolView = withUniwind(AppSymbolView);
