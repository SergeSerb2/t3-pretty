import type { NativeStackHeaderItem } from "@react-navigation/native-stack";
import type { ReactElement } from "react";
import { Platform } from "react-native";

/**
 * Screen options that supply a native back button. Use as
 * a navigator's `screenOptions` function: header `canGoBack` also counts a
 * parent stack, which would put a back button on the root of a sheet, so this
 * checks the screen's own stack instead. Screens that set their own left
 * items replace it. Items rather than `headerLeft`, which cannot hide the
 * system glass capsule.
 */
export function mintGlassBackOptions(props: {
  readonly navigation: {
    getState(): { readonly routes: ReadonlyArray<{ readonly key: string }> };
    goBack(): void;
  };
  readonly route: { readonly key: string };
}) {
  if (Platform.OS !== "ios") return {};
  const hasPrevious =
    props.navigation.getState().routes.findIndex((route) => route.key === props.route.key) > 0;
  return {
    headerBackVisible: false,
    unstable_headerLeftItems: hasPrevious
      ? () => [mintGlassBackItem(() => props.navigation.goBack())]
      : undefined,
  };
}

/** A custom header view that draws its own chrome, without the system capsule. */
export function mintGlassCustomItem(element: ReactElement): NativeStackHeaderItem {
  return { type: "custom", hidesSharedBackground: true, element };
}

/** A native back item that uses the same system appearance as other toolbar buttons. */
export function mintGlassBackItem(onPress: () => void): NativeStackHeaderItem {
  return {
    type: "button",
    label: "Back",
    accessibilityLabel: "Back",
    icon: { type: "sfSymbol", name: "chevron.left" },
    onPress,
  };
}
