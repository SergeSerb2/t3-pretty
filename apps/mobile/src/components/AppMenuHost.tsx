import type { MenuAction, MenuComponentProps } from "@react-native-menu/menu";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";

import { AnchoredMenu, type MenuEdgePlacement } from "./AndroidAnchoredMenu";

export type { MenuEdgePlacement };

export type AppMenuRequest = {
  readonly actions: readonly MenuAction[];
  readonly title?: string;
  readonly placement: MenuEdgePlacement;
  readonly onPressAction?: MenuComponentProps["onPressAction"];
};

let presentRequest: ((request: AppMenuRequest) => void) | null = null;

/**
 * Present the app-styled menu from a native bar button that has no RN anchor
 * view. Requires AppMenuHost at the app root.
 */
export function presentAppMenu(request: AppMenuRequest): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  presentRequest?.(request);
}

export type AppMenuActionItem = {
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly iconName?: string;
  readonly onPress: () => void;
};

/** Present a flat action list from native header menu descriptors. */
export function presentActionListMenu(input: {
  readonly title?: string;
  readonly placement: MenuEdgePlacement;
  readonly items: ReadonlyArray<AppMenuActionItem>;
}): void {
  const handlers = new Map<string, () => void>();
  const actions: MenuAction[] = input.items.map((item, index) => {
    const id = String(index);
    handlers.set(id, item.onPress);
    return {
      id,
      title: item.label,
      subtitle: item.description,
      image: item.iconName,
      attributes: item.disabled === true ? { disabled: true } : undefined,
    };
  });
  presentAppMenu({
    actions,
    placement: input.placement,
    title: input.title,
    onPressAction: (event) => {
      handlers.get(event.nativeEvent.event)?.();
    },
  });
}

export function AppMenuHost() {
  const [request, setRequest] = useState<AppMenuRequest | null>(null);

  useEffect(() => {
    const present = setRequest;
    presentRequest = present;
    return () => {
      if (presentRequest === present) {
        presentRequest = null;
      }
    };
  }, []);

  if (request === null) {
    return null;
  }

  return (
    <AnchoredMenu
      actions={request.actions}
      onPressAction={request.onPressAction}
      onRequestClose={() => setRequest(null)}
      placement={request.placement}
      title={request.title}
    />
  );
}
