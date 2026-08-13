import { MenuView } from "@react-native-menu/menu";
import * as Haptics from "expo-haptics";
import {
  cloneElement,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useRef,
} from "react";
import { Platform, Pressable, useColorScheme } from "react-native";
import { useThemeColor } from "../lib/useThemeColor";

import { cn } from "../lib/cn";
import { AnchoredMenu } from "./AnchoredMenu";
import { SymbolView } from "./AppSymbol";
import { AppText as Text } from "./AppText";
import { ComposerSendIconSlot } from "./ComposerSendIndicator";

export function ControlPill(props: {
  readonly icon?: ComponentProps<typeof SymbolView>["name"];
  readonly iconNode?: ReactNode;
  readonly label?: string;
  readonly accessibilityLabel?: string;
  readonly onPress?: () => void;
  readonly activateOnPressIn?: boolean;
  readonly variant?: "circle" | "pill" | "primary" | "danger";
  readonly disabled?: boolean;
  /** In-flight send: keep the primary fill and swap the icon for a spinner. */
  readonly loading?: boolean;
  readonly className?: string;
}) {
  const variant = props.variant ?? "circle";
  const isLoading = props.loading === true;
  const showDisabledChrome = props.disabled === true && !isLoading;
  const activatedOnPressInRef = useRef(false);

  const handlePressIn = () => {
    activatedOnPressInRef.current = true;
    props.onPress?.();
  };
  const handlePressOut = () => {
    // Pressability invokes onPressOut immediately before onPress on release.
    // Defer the reset so onPress can identify the same physical gesture.
    setTimeout(() => {
      activatedOnPressInRef.current = false;
    }, 0);
  };
  const handlePress = () => {
    if (activatedOnPressInRef.current) {
      return;
    }
    props.onPress?.();
  };

  const iconColor = useThemeColor("--color-icon");
  const iconSubtle = useThemeColor("--color-icon-subtle");
  const primaryFg = useThemeColor("--color-primary-foreground");
  const dangerFg = useThemeColor("--color-danger-foreground");
  const iconTintColor =
    variant === "primary"
      ? showDisabledChrome
        ? iconSubtle
        : primaryFg
      : variant === "danger"
        ? dangerFg
        : iconColor;

  const isCircle =
    variant === "circle" || variant === "danger" || (variant === "primary" && !props.label);
  const containerClassName = cn(
    isCircle
      ? "h-11 w-11 items-center justify-center rounded-full"
      : variant === "primary"
        ? "h-11 flex-row items-center justify-center gap-2 rounded-full px-5"
        : "h-11 flex-row items-center justify-center gap-2 rounded-full px-3.5",
    variant === "primary"
      ? showDisabledChrome
        ? "bg-subtle-strong"
        : "bg-primary"
      : variant === "danger"
        ? "bg-danger"
        : "bg-subtle",
    props.className,
  );
  const labelClassName = cn(
    "text-center text-xs font-t3-bold",
    variant === "primary"
      ? showDisabledChrome
        ? "text-foreground-muted"
        : "text-primary-foreground"
      : "",
  );

  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled === true, busy: isLoading }}
      onPress={props.activateOnPressIn ? handlePress : props.onPress}
      onPressIn={props.activateOnPressIn ? handlePressIn : undefined}
      onPressOut={props.activateOnPressIn ? handlePressOut : undefined}
      disabled={props.disabled || isLoading}
      className={containerClassName}
    >
      {props.iconNode || props.icon || isLoading ? (
        <ComposerSendIconSlot loading={isLoading} color={String(iconTintColor)}>
          {props.iconNode ? (
            props.iconNode
          ) : props.icon ? (
            <SymbolView name={props.icon} size={16} tintColor={iconTintColor} type="monochrome" />
          ) : null}
        </ComposerSendIconSlot>
      ) : null}
      {props.label ? <Text className={labelClassName}>{props.label}</Text> : null}
    </Pressable>
  );
}

// Tap menus use the token-styled AnchoredMenu on every platform so World
// Scenery chrome isn't interrupted by a stock UIMenu / AppCompat popup.
// iOS long-press row actions keep MenuView: that path is a real
// UIContextMenuInteraction with the row as the zoom preview.
export function ControlPillMenu(
  props: Omit<ComponentProps<typeof MenuView>, "children" | "themeVariant"> & {
    readonly children: ReactNode;
    readonly className?: string;
    readonly disabled?: boolean;
  },
) {
  const isDarkMode = useColorScheme() === "dark";
  // Android's wrapper owns the press (`pointerEvents="none"` on children),
  // and iOS MenuView intercepts taps on the host view, so a disabled child
  // pill is not enough — skip the menu host entirely while locked.
  if (props.disabled) {
    return props.children;
  }

  const useNativeContextMenu = Platform.OS === "ios" && props.shouldOpenOnLongPress === true;
  if (!useNativeContextMenu) {
    // Long-press menus keep their child interactive: the child element gets
    // an injected onLongPress (mirroring the iOS context-menu interaction)
    // so its own tap handling still works.
    if (props.shouldOpenOnLongPress && isValidElement(props.children)) {
      const child = props.children as ReactElement<{ onLongPress?: () => void }>;
      return (
        <AnchoredMenu
          actions={props.actions}
          className={props.className}
          title={props.title}
          style={props.style}
          onPressAction={props.onPressAction}
        >
          {(open) =>
            cloneElement(child, {
              onLongPress: () => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                open();
              },
            })
          }
        </AnchoredMenu>
      );
    }
    return (
      <AnchoredMenu
        actions={props.actions}
        className={props.className}
        title={props.title}
        style={props.style}
        onPressAction={props.onPressAction}
      >
        {props.children}
      </AnchoredMenu>
    );
  }

  const { className: _className, disabled: _disabled, ...menuProps } = props;
  let children = menuProps.children;
  // In long-press mode the wrapped pressable still receives the touch (the
  // patched MenuView button is touch-transparent) and RN's Fabric touch
  // handler is never cancelled by the in-tree UIContextMenuInteraction, so a
  // bare onPress would fire on finger-up even after the menu opened — and
  // also on a long press released just under the menu threshold. A dispatched
  // onLongPress makes Pressability swallow the release, so holds past 350ms
  // (below the ~500ms context-menu threshold) can only open the menu, never
  // tap through.
  if (isValidElement(children)) {
    const child = children as ReactElement<{ onLongPress?: () => void; delayLongPress?: number }>;
    children = cloneElement(child, {
      onLongPress: child.props.onLongPress ?? (() => undefined),
      delayLongPress: child.props.delayLongPress ?? 350,
    });
  }
  return (
    <MenuView {...menuProps} themeVariant={isDarkMode ? "dark" : "light"}>
      {children}
    </MenuView>
  );
}
