import type { ComponentProps } from "react";
import Animated from "react-native-reanimated";

import { GlassSurface } from "../../components/GlassSurface";
import { useGlassChromeActive } from "../scenery/SceneryProvider";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

const AnimatedGlassSurface = Animated.createAnimatedComponent(GlassSurface);
const GLASS_SHAPE = { borderRadius: 20, borderCurve: "continuous" } as const;

/**
 * A card floating with the composer (requests, notices, limits). Over scenery
 * it wears the composer's own frosted material so the stack reads as one
 * piece; otherwise it is a plain view with the caller's opaque `className`.
 * `glassClassName` carries only layout classes for the glass variant.
 */
export function ComposerStackCard({
  className,
  glassClassName,
  style,
  children,
  ...props
}: ComponentProps<typeof Animated.View> & { readonly glassClassName?: string }) {
  const glass = useGlassChromeActive();
  const { themeVariables } = useAppearancePreferences();
  if (!glass) {
    return (
      <Animated.View {...props} className={className} style={style}>
        {children}
      </Animated.View>
    );
  }
  return (
    <AnimatedGlassSurface
      {...props}
      chrome="none"
      fallbackColor={themeVariables["--color-chrome-glass"]}
      fallbackClassName="border border-composer-border"
      className={glassClassName}
      style={[GLASS_SHAPE, style]}
    >
      {children}
    </AnimatedGlassSurface>
  );
}
