import { GlassView, isGlassEffectAPIAvailable } from "expo-glass-effect";
import type { ReactNode } from "react";
import {
  Platform,
  useColorScheme,
  View,
  type ColorValue,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { useThemeColor } from "../lib/useThemeColor";

export interface GlassSurfaceProps extends Omit<ViewProps, "className"> {
  readonly children: ReactNode;
  readonly glassEffectStyle?: "clear" | "regular" | "none";
  readonly tintColor?: ColorValue;
  readonly chrome?: "default" | "none";
}

export function GlassSurface({
  children,
  glassEffectStyle = "regular",
  chrome = "default",
  tintColor,
  style,
  ...props
}: GlassSurfaceProps) {
  const isDarkMode = useColorScheme() === "dark";
  const borderColor = useThemeColor("--color-chrome-glass-border");
  const glassSurface = useThemeColor("--color-glass-surface");
  const glassTint = useThemeColor("--color-glass-tint");
  const shadowColor = useThemeColor("--color-drawer-shadow");
  const supportsGlass = Platform.OS === "ios" && isGlassEffectAPIAvailable();
  const surfaceStyle: ViewStyle = {
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: chrome === "none" ? 0 : 1,
    borderColor: chrome === "none" ? "transparent" : borderColor,
    backgroundColor: chrome === "none" ? "transparent" : glassSurface,
    shadowColor: chrome === "none" ? "transparent" : shadowColor,
    shadowOpacity: chrome === "none" ? 0 : 1,
    shadowRadius: chrome === "none" ? 0 : 18,
    shadowOffset:
      chrome === "none"
        ? {
            width: 0,
            height: 0,
          }
        : {
            width: 0,
            height: 8,
          },
    elevation: chrome === "none" ? 0 : 6,
  };

  if (supportsGlass) {
    return (
      <GlassView
        {...props}
        glassEffectStyle={glassEffectStyle}
        tintColor={String(tintColor ?? glassTint)}
        colorScheme={isDarkMode ? "dark" : "light"}
        style={[surfaceStyle, style]}
      >
        {children}
      </GlassView>
    );
  }

  return (
    <View {...props} style={[surfaceStyle, style]}>
      {children}
    </View>
  );
}
