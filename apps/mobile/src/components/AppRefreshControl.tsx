import { RefreshControl, type RefreshControlProps } from "react-native";

import { hapticTap } from "../lib/haptics";

/** Pull-to-refresh with a tap at the moment the pull commits. Props pass through. */
export function AppRefreshControl({ onRefresh, ...props }: RefreshControlProps) {
  return (
    <RefreshControl
      {...props}
      onRefresh={
        onRefresh
          ? () => {
              hapticTap();
              onRefresh();
            }
          : undefined
      }
    />
  );
}
