import * as Haptics from "expo-haptics";
import { ActionSheetIOS, Alert, Platform, Share } from "react-native";

import { copyTextWithHaptic } from "./copyTextWithHaptic";
import {
  markdownLinkActionItems,
  markdownLinkActionTitle,
  markdownLinkCopyValue,
  type MarkdownLinkAction,
} from "./markdownLinkActions";

export function showMarkdownLinkActionSheet(options: {
  readonly href: string;
  readonly onOpen: (href: string) => void;
}): void {
  const actions = markdownLinkActionItems(options.href);
  if (actions.length === 0) {
    return;
  }

  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

  const runAction = (id: MarkdownLinkAction) => {
    if (id === "open") {
      options.onOpen(options.href);
      return;
    }
    if (id === "copy") {
      copyTextWithHaptic(markdownLinkCopyValue(options.href), { target: "markdown-link" });
      return;
    }
    void Share.share(
      Platform.OS === "ios" ? { url: options.href } : { message: options.href, url: options.href },
    ).catch(() => undefined);
  };

  const title = markdownLinkActionTitle(options.href) ?? undefined;

  if (Platform.OS === "ios" && Platform.isPad !== true) {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...actions.map((action) => action.label), "Cancel"],
        cancelButtonIndex: actions.length,
        title,
      },
      (buttonIndex) => {
        const action = actions[buttonIndex];
        if (action) {
          runAction(action.id);
        }
      },
    );
    return;
  }

  // Android Alert supports at most three buttons; keep Open/Copy + Cancel.
  const alertActions =
    Platform.OS === "android" ? actions.filter((action) => action.id !== "share") : actions;

  Alert.alert(title ?? "Link", options.href, [
    ...alertActions.map((action) => ({
      text: action.label,
      onPress: () => runAction(action.id),
    })),
    { text: "Cancel", style: "cancel" as const },
  ]);
}
