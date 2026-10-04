import { View, type ViewProps } from "react-native";

import { cn } from "../lib/cn";
import { SceneryBackdrop } from "../features/scenery/SceneryBackdrop";
import { useGlassChromeActive } from "../features/scenery/SceneryProvider";

/**
 * Root plate for sheet screens. While glass chrome is active a photo
 * continues under the sheet so grouped sections float over it: the thread's
 * own photo for `threadKey`, otherwise the day's. Without glass it is the
 * opaque sheet color.
 */
export function SheetSurface({
  className,
  children,
  threadKey = null,
  ...props
}: ViewProps & { readonly threadKey?: string | null }) {
  const glass = useGlassChromeActive();
  return (
    <View
      collapsable={false}
      {...props}
      className={cn("flex-1", glass ? "bg-screen" : "bg-sheet", className)}
    >
      {glass ? <SceneryBackdrop threadKey={threadKey} surface="cards" /> : null}
      {children}
    </View>
  );
}
