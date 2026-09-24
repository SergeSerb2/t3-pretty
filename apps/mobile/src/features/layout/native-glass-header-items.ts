type NativeGlassHeaderItem = {
  readonly type: "button" | "menu";
  readonly glassEffect?: boolean;
  readonly hidesSharedBackground?: boolean;
  readonly sharesBackground?: boolean;
  readonly variant?: "plain" | "done" | "prominent";
  readonly width?: number;
};

/**
 * iOS 26/27 Mail-style header controls need the native glass button
 * shared background configuration when they are not part of a larger toolbar.
 * Do not enable `glassEffect` for normal bar-button items: react-native-screens
 * renders that as a custom UIButton, which creates a second skinny capsule.
 * `sharesBackground` stays off while the native kill-switch is down: the
 * patched header still assigned trailingItemGroups / sharesBackground on
 * first Home chrome after #708, and UIKit 26+ builds glass for those groups.
 */
export function withNativeGlassHeaderItem<T extends NativeGlassHeaderItem>(
  item: T,
  options: {
    readonly hidesSharedBackground?: boolean;
    readonly sharesBackground?: boolean;
    readonly width?: number;
  } = {},
): T &
  Pick<
    NativeGlassHeaderItem,
    "glassEffect" | "hidesSharedBackground" | "sharesBackground" | "variant"
  > {
  const sharesBackground = options.sharesBackground ?? item.sharesBackground ?? false;
  return {
    ...item,
    glassEffect: item.glassEffect ?? false,
    hidesSharedBackground: options.hidesSharedBackground ?? item.hidesSharedBackground ?? false,
    sharesBackground,
    variant: item.variant ?? "plain",
    width: options.width ?? item.width,
  };
}
