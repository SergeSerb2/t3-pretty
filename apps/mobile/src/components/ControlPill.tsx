import { MenuView } from "@react-native-menu/menu";
import * as Haptics from "expo-haptics";
import {
  cloneElement,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Platform, Pressable, View, type ColorValue, type PressableProps } from "react-native";
import { withUniwind } from "uniwind";
import { useThemeColor } from "../lib/useThemeColor";
import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";

import { cn } from "../lib/cn";
import { withMenuActionIconColors } from "../lib/menu-action-colors";
import { AnchoredMenu } from "./AndroidAnchoredMenu";
import { SymbolView } from "./AppSymbol";
import { AppText as Text } from "./AppText";
import { ComposerSendIconSlot } from "./ComposerSendIndicator";

const ThemedMenuView = withUniwind(
  function NativeMenuView({
    iconColor,
    destructiveIconColor,
    ...props
  }: ComponentProps<typeof MenuView> & {
    readonly iconColor?: ColorValue;
    readonly destructiveIconColor?: ColorValue;
  }) {
    const actions = useMemo(
      () =>
        withMenuActionIconColors(props.actions, {
          icon: iconColor,
          destructiveIcon: destructiveIconColor,
        }),
      [props.actions, iconColor, destructiveIconColor],
    );
    return <MenuView {...props} actions={actions} />;
  },
  {
    iconColor: { fromClassName: "iconColorClassName", styleProperty: "accentColor" },
    destructiveIconColor: {
      fromClassName: "destructiveIconColorClassName",
      styleProperty: "accentColor",
    },
  },
);

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
  const pressResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pressResetTimerRef.current) {
        clearTimeout(pressResetTimerRef.current);
      }
    },
    [],
  );

  const handlePressIn = () => {
    if (pressResetTimerRef.current) {
      clearTimeout(pressResetTimerRef.current);
      pressResetTimerRef.current = null;
    }
    activatedOnPressInRef.current = true;
    props.onPress?.();
  };
  const handlePressOut = () => {
    // Pressability invokes onPressOut immediately before onPress on release.
    // Defer the reset so onPress can identify the same physical gesture.
    pressResetTimerRef.current = setTimeout(() => {
      activatedOnPressInRef.current = false;
      pressResetTimerRef.current = null;
    }, 0);
  };
  const handlePress = () => {
    if (activatedOnPressInRef.current) {
      return;
    }
    props.onPress?.();
  };

  const iconTintClassName =
    variant === "primary"
      ? showDisabledChrome
        ? "accent-icon-subtle"
        : "accent-primary-foreground"
      : variant === "danger"
        ? "accent-danger-foreground"
        : "accent-icon";
  const iconTintColor = useThemeColor(iconTintClassName);

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
            <SymbolView
              name={props.icon}
              size={16}
              tintColorClassName={iconTintClassName}
              type="monochrome"
            />
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
  const { themeAppearance } = useAppearancePreferences();
  const isDarkMode = themeAppearance === "dark";
  const menuPress = useRef({ isPreparing: false, isOpen: false, suppressPress: false });
  const pendingPress = useRef<(() => void) | null>(null);

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
  if (props.shouldOpenOnLongPress && isValidElement(children)) {
    const child = children as ReactElement<Pick<PressableProps, "onTouchStart" | "onPress">>;
    children = cloneElement(child, {
      onTouchStart: (event) => {
        // Reset for a new touch, not onPressIn, which also fires when a
        // finger moves out of the row and back during the same gesture.
        menuPress.current.isPreparing = false;
        menuPress.current.suppressPress = menuPress.current.isOpen;
        pendingPress.current = null;
        child.props.onTouchStart?.(event);
      },
      onPress: (event) => {
        // Accessibility clicks have no touch identifier and must not inherit
        // cancellation from a previous physical gesture.
        const isTouch = typeof event.nativeEvent.identifier === "number";
        if (isTouch ? menuPress.current.suppressPress : menuPress.current.isOpen) {
          return;
        }
        if (isTouch && menuPress.current.isPreparing) {
          // A release can arrive between native menu preparation and display.
          // Let UIKit's display/cancel callback decide this press's outcome.
          event.persist();
          pendingPress.current = () => child.props.onPress?.(event);
          return;
        }
        child.props.onPress?.(event);
      },
    });
    menuProps.onMenuInteractionStart = () => {
      menuPress.current.isPreparing = true;
      props.onMenuInteractionStart?.();
    };
    menuProps.onOpenMenu = () => {
      menuPress.current.isPreparing = false;
      menuPress.current.isOpen = true;
      menuPress.current.suppressPress = true;
      pendingPress.current = null;
      props.onOpenMenu?.();
    };
    menuProps.onCloseMenu = () => {
      menuPress.current.isPreparing = false;
      menuPress.current.isOpen = false;
      // Keep this gesture cancelled even if dismissal precedes finger-up.
      // A separate JS long-press timer would also swallow holds that never
      // open the native menu.
      const press = pendingPress.current;
      pendingPress.current = null;
      props.onCloseMenu?.();
      if (!menuPress.current.suppressPress) {
        press?.();
      }
    };
  }
  return (
    <ThemedMenuView
      {...menuProps}
      iconColorClassName="accent-icon"
      destructiveIconColorClassName="accent-danger-foreground"
      themeVariant={isDarkMode ? "dark" : "light"}
    >
      {children}
    </ThemedMenuView>
  );
}
