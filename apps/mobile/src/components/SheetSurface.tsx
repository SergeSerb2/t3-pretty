import { View, type ViewProps } from "react-native";

import { cn } from "../lib/cn";
import { SceneryBackdrop } from "../features/scenery/SceneryBackdrop";
import { useGlassChromeActive } from "../features/scenery/SceneryProvider";

/**
 * Root plate for sheet screens. While glass chrome is active the day's photo
 * continues under the sheet so grouped sections float over it; otherwise it
 * is the opaque sheet color.
 */
export function SheetSurface({ className, children, ...props }: ViewProps) {
  const glass = useGlassChromeActive();
  return (
    <View
      collapsable={false}
      {...props}
      className={cn("flex-1", glass ? "bg-screen" : "bg-sheet", className)}
    >
      {glass ? <SceneryBackdrop threadKey={null} /> : null}
      {children}
    </View>
  );
}
