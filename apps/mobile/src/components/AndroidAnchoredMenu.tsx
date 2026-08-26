import { isLiquidGlassSupported, LiquidGlassView } from "@callstack/liquid-glass";
import type { MenuAction, MenuComponentProps } from "@react-native-menu/menu";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import {
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useColorScheme,
  View,
} from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { appBlurTargetRef } from "../lib/appBlurTarget";
import { useThemeColor } from "../lib/useThemeColor";
import { cn } from "../lib/cn";
import { flattenMenuActions } from "./anchored-menu.logic";
import { type AppSymbolName, SymbolView } from "./AppSymbol";
import { AppText as Text } from "./AppText";
import { OverlayPortal } from "./OverlayPortal";

const MENU_WIDTH = 268;
const MENU_RADIUS = 16;
const SCREEN_MARGIN = 12;
const ANCHOR_GAP = 8;
const EDGE_BUTTON_SIZE = 44;
const EDGE_INSET = 16;
const BOTTOM_TOOLBAR_CLEARANCE = 56;

const MENU_ENTERING = FadeIn.duration(180).reduceMotion(ReduceMotion.System);

const PLACEHOLDER_ANCHOR = { x: 0, y: 0, width: 0, height: 0 } as const;

export type MenuEdgePlacement = "top-start" | "top-end" | "bottom-start" | "bottom-end";

type AnchorSnapshot = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type OverlayFrame = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type EdgeInsets = {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
};

export type AnchoredMenuProps = {
  readonly actions: readonly MenuAction[];
  readonly title?: string;
  readonly onPressAction?: MenuComponentProps["onPressAction"];
  readonly className?: string;
  readonly style?: StyleProp<ViewStyle>;
  /**
   * Plain children open the menu on tap (the wrapper owns the press). A
   * render function keeps the children interactive and hands them `open` to
   * call from their own gesture — e.g. a row that selects on tap and opens
   * this menu on long-press.
   */
  readonly children?: ReactNode | ((open: () => void) => ReactNode);
  /**
   * Host-controlled presentation: skip the child anchor and pin the menu to a
   * screen-edge control (native toolbar / header buttons have no RN view).
   */
  readonly placement?: MenuEdgePlacement;
  readonly onRequestClose?: () => void;
};

function anchorForPlacement(
  placement: MenuEdgePlacement,
  overlay: OverlayFrame,
  insets: EdgeInsets,
): AnchorSnapshot {
  const size = EDGE_BUTTON_SIZE;
  switch (placement) {
    case "bottom-start":
      return {
        x: overlay.x + insets.left + EDGE_INSET,
        y: overlay.y + overlay.height - insets.bottom - BOTTOM_TOOLBAR_CLEARANCE - size,
        width: size,
        height: size,
      };
    case "bottom-end":
      return {
        x: overlay.x + overlay.width - insets.right - EDGE_INSET - size,
        y: overlay.y + overlay.height - insets.bottom - BOTTOM_TOOLBAR_CLEARANCE - size,
        width: size,
        height: size,
      };
    case "top-start":
      return {
        x: overlay.x + insets.left + EDGE_INSET,
        y: overlay.y + insets.top,
        width: size,
        height: size,
      };
    case "top-end":
      return {
        x: overlay.x + overlay.width - insets.right - EDGE_INSET - size,
        y: overlay.y + insets.top,
        width: size,
        height: size,
      };
  }
}

/**
 * Token-styled anchored dropdown used on both platforms. iOS tap menus used
 * to be stock UIMenu; that chrome reads as a foreign sheet over World Scenery
 * glass cards, so this surface matches the rest of the app (16pt continuous
 * radius, frosted card, DM Sans rows). Long-press row previews still use the
 * native context menu.
 *
 * Lives at upstream's AndroidAnchoredMenu.tsx path on purpose: keeping the
 * implementation in the file upstream edits lets nightly syncs merge as
 * ordinary hunks. A re-export shim here turned every upstream touch into a
 * whole-file conflict the sync resolver could not settle.
 */
export function AnchoredMenu(props: AnchoredMenuProps) {
  const isPlacementMode = props.placement !== undefined;
  const [measuredAnchor, setMeasuredAnchor] = useState<AnchorSnapshot | null>(
    isPlacementMode ? PLACEHOLDER_ANCHOR : null,
  );
  const [path, setPath] = useState<readonly MenuAction[]>([]);
  const [rootHeight, setRootHeight] = useState<number | null>(null);
  const [overlay, setOverlay] = useState<OverlayFrame | null>(null);
  const anchorRef = useRef<View>(null);
  const overlayRef = useRef<View>(null);
  const insets = useSafeAreaInsets();

  const isDarkMode = useColorScheme() === "dark";
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const keyboardHeight = useKeyboardState((state) => state.height);
  const rippleColor = useThemeColor("--color-subtle");
  const iconColor = useThemeColor("--color-icon");
  const iconSubtleColor = useThemeColor("--color-icon-subtle");
  const dangerColor = useThemeColor("--color-danger-foreground");
  const chromeFill = useThemeColor("--color-chrome-glass");
  const chromeBorder = useThemeColor("--color-chrome-glass-border");

  const close = useCallback(() => {
    if (isPlacementMode) {
      props.onRequestClose?.();
      return;
    }
    setMeasuredAnchor(null);
    setPath([]);
    setOverlay(null);
    setRootHeight(null);
  }, [isPlacementMode, props.onRequestClose]);

  const open = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setMeasuredAnchor({ x, y, width, height });
    });
  }, []);

  const measureOverlay = useCallback(() => {
    overlayRef.current?.measureInWindow((x, y, width, height) => {
      setOverlay({ x, y, width, height });
      setRootHeight(height);
    });
  }, []);

  const submenuDepth = path.length;
  useEffect(() => {
    if (measuredAnchor === null) {
      return;
    }
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (submenuDepth > 0) {
        setPath((current) => current.slice(0, -1));
      } else {
        close();
      }
      return true;
    });
    return () => subscription.remove();
  }, [close, measuredAnchor, submenuDepth]);

  const parent = path.length > 0 ? path[path.length - 1] : null;
  const levelActions = flattenMenuActions(parent?.subactions ?? props.actions);

  const resolvedAnchor =
    isPlacementMode && overlay !== null && props.placement !== undefined
      ? anchorForPlacement(props.placement, overlay, insets)
      : measuredAnchor;

  const local =
    resolvedAnchor === null || overlay === null
      ? null
      : {
          x: resolvedAnchor.x - overlay.x,
          y: resolvedAnchor.y - overlay.y,
          width: resolvedAnchor.width,
          height: resolvedAnchor.height,
        };
  const preferredLeft =
    local === null || overlay === null
      ? 0
      : local.x + local.width / 2 <= overlay.width / 2
        ? local.x
        : local.x + local.width - MENU_WIDTH;
  const left =
    overlay === null
      ? 0
      : Math.min(
          Math.max(preferredLeft, SCREEN_MARGIN),
          overlay.width - MENU_WIDTH - SCREEN_MARGIN,
        );
  const usableBottom =
    overlay === null ? 0 : overlay.height - (keyboardVisible ? keyboardHeight : 0);
  const spaceBelow =
    local === null || overlay === null
      ? 0
      : usableBottom - (local.y + local.height) - ANCHOR_GAP - SCREEN_MARGIN;
  const spaceAbove = local === null ? 0 : local.y - ANCHOR_GAP - SCREEN_MARGIN;
  const opensDown = spaceBelow >= 280 || spaceBelow >= spaceAbove;
  const maxHeight = Math.min(opensDown ? spaceBelow : spaceAbove, 480);
  const placeable = local !== null && rootHeight !== null && resolvedAnchor !== PLACEHOLDER_ANCHOR;

  const onPressItem = useCallback(
    (action: MenuAction) => {
      if ((action.subactions?.length ?? 0) > 0) {
        setPath((current) => [...current, action]);
        return;
      }
      if (action.id !== undefined) {
        props.onPressAction?.({
          nativeEvent: { event: action.id },
        } as Parameters<NonNullable<MenuComponentProps["onPressAction"]>>[0]);
      }
      if (action.attributes?.keepsMenuPresented === true) {
        return;
      }
      close();
    },
    [close, props.onPressAction],
  );

  const menuBody = (
    <ScrollView
      bounces={false}
      keyboardShouldPersistTaps="always"
      showsVerticalScrollIndicator={false}
    >
      {parent !== null ? (
        <Pressable
          accessibilityLabel={`Back to ${parent.title}`}
          accessibilityRole="button"
          className="px-3.5 pb-1 pt-2.5"
          onPress={() => setPath((current) => current.slice(0, -1))}
        >
          <Text className="text-3xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
            {parent.title}
          </Text>
        </Pressable>
      ) : props.title ? (
        <View className="px-3.5 pb-1 pt-2.5">
          <Text className="text-3xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
            {props.title}
          </Text>
        </View>
      ) : null}
      {levelActions.map((row, index) => {
        if (row.type === "header") {
          return (
            <View key={row.key} className={cn("px-3.5 pb-1", index === 0 ? "pt-2.5" : "pt-3")}>
              <Text className="text-3xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
                {row.title}
              </Text>
            </View>
          );
        }
        const action = row.action;
        const destructive = action.attributes?.destructive ?? false;
        const disabled = action.attributes?.disabled ?? false;
        const hasSubmenu = (action.subactions?.length ?? 0) > 0;
        return (
          <Pressable
            key={action.id ?? `${index}-${action.title}`}
            accessibilityRole="button"
            accessibilityState={{ disabled, selected: action.state === "on" }}
            android_ripple={Platform.OS === "android" ? { color: rippleColor } : undefined}
            disabled={disabled}
            className={cn(
              "min-h-11 flex-row items-center gap-2.5 px-3.5 py-2.5",
              disabled && "opacity-45",
            )}
            style={({ pressed }) =>
              pressed && Platform.OS === "ios" ? { opacity: 0.6 } : undefined
            }
            onPress={() => onPressItem(action)}
          >
            <View className="flex-1 gap-0.5">
              <Text
                className={cn("text-sm font-t3-medium", destructive && "text-danger-foreground")}
              >
                {action.title}
              </Text>
              {action.subtitle ? (
                <Text className="text-xs leading-snug text-foreground-muted">
                  {action.subtitle}
                </Text>
              ) : null}
            </View>
            {hasSubmenu ? (
              <SymbolView
                name="chevron.right"
                size={13}
                tintColor={iconSubtleColor}
                type="monochrome"
              />
            ) : action.state === "on" ? (
              <SymbolView name="checkmark" size={15} tintColor={iconColor} type="monochrome" />
            ) : action.image ? (
              <SymbolView
                name={action.image as AppSymbolName}
                size={15}
                tintColor={destructive ? dangerColor : iconColor}
                type="monochrome"
              />
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const menuFrameStyle: ViewStyle = {
    borderColor: chromeBorder,
    borderCurve: "continuous",
    borderRadius: MENU_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    left,
    maxHeight,
    overflow: "hidden",
    position: "absolute",
    width: MENU_WIDTH,
    ...(opensDown
      ? { top: local === null ? 0 : local.y + local.height + ANCHOR_GAP }
      : { bottom: (rootHeight ?? 0) - (local?.y ?? 0) + ANCHOR_GAP }),
  };

  const overlayMenu =
    !placeable || local === null ? null : (
      <Animated.View
        accessibilityViewIsModal
        entering={MENU_ENTERING}
        onAccessibilityEscape={close}
        style={menuFrameStyle}
      >
        {Platform.OS === "ios" && isLiquidGlassSupported ? (
          <View style={{ backgroundColor: chromeFill, flexGrow: 1 }}>
            <LiquidGlassView
              colorScheme={isDarkMode ? "dark" : "light"}
              effect="regular"
              interactive={false}
              style={{ flexGrow: 1, overflow: "hidden" }}
            >
              {menuBody}
            </LiquidGlassView>
          </View>
        ) : (
          <>
            <BlurView
              blurMethod={Platform.OS === "android" ? "dimezisBlurView" : undefined}
              blurTarget={Platform.OS === "android" ? appBlurTargetRef : undefined}
              intensity={Platform.OS === "ios" ? 50 : 40}
              tint={isDarkMode ? "dark" : "light"}
              className="absolute inset-0"
            />
            <View className="absolute inset-0 bg-card-translucent" />
            {menuBody}
          </>
        )}
      </Animated.View>
    );

  return (
    <>
      {isPlacementMode ? null : typeof props.children === "function" ? (
        <View ref={anchorRef} collapsable={false} className={props.className} style={props.style}>
          {props.children(open)}
        </View>
      ) : (
        <Pressable
          ref={anchorRef}
          accessibilityRole="button"
          className={props.className}
          collapsable={false}
          style={props.style}
          onPress={open}
        >
          <View pointerEvents="none">{props.children}</View>
        </Pressable>
      )}
      {measuredAnchor === null ? null : (
        <OverlayPortal>
          <View
            ref={overlayRef}
            collapsable={false}
            className="absolute inset-0"
            onLayout={measureOverlay}
          >
            <Pressable
              accessibilityLabel="Dismiss menu"
              accessibilityRole="button"
              accessible={false}
              className="absolute inset-0"
              onPress={close}
            />
            {overlayMenu}
          </View>
        </OverlayPortal>
      )}
    </>
  );
}

/** @deprecated Use AnchoredMenu — the same surface now ships on iOS tap menus. */
export const AndroidAnchoredMenu = AnchoredMenu;
export type AndroidAnchoredMenuProps = AnchoredMenuProps;
