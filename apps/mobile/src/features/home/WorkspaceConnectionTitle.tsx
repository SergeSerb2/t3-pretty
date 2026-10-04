import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Platform, Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { useAndroidControlSizing } from "../../components/useAndroidControlSizing";
import {
  brandTitleOffset,
  CompactBrandTitle,
  getCompactBrandHeaderOptions,
} from "../../components/CompactBrandTitle";
import { useWorkspaceState } from "../../state/workspace";
import {
  workspaceConnectionStatusPresentation,
  type WorkspaceConnectionStatusPresentation,
} from "./workspace-connection-status";

/**
 * Delay before a connection interruption surfaces in the title slot. Sub-second
 * blips (the common reconnect case) resolve without any UI at all.
 */
const STATUS_SHOW_DELAY_MS = 800;
const FADE_IN_MS = 250;

/**
 * Connection status presentation, debounced for display: null until the
 * workspace has been in a non-connected state for STATUS_SHOW_DELAY_MS,
 * then live-updating until the workspace reconnects (null again immediately).
 */
function useDelayedConnectionStatus(): WorkspaceConnectionStatusPresentation | null {
  const { state } = useWorkspaceState();
  const presentation = workspaceConnectionStatusPresentation(state);
  const hasStatus = presentation !== null;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!hasStatus) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), STATUS_SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [hasStatus]);

  return visible ? presentation : null;
}

/**
 * One-shot entrance fade for the status label. Deliberately JS-driven: this can
 * mount inside a native header item (RNSScreenStackHeaderSubview), where
 * native-driver animated nodes blank the re-hosted view entirely. The JS driver
 * updates opacity through the ordinary style path, which those subviews handle.
 */
function StatusFadeIn(props: {
  readonly children: ReactNode;
  readonly grow?: boolean;
  readonly maxWidth?: number;
  /** Centers the status on a slot this wide (phone titles are centered). */
  readonly centeredOnWidth?: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      duration: FADE_IN_MS,
      toValue: 1,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      collapsable={false}
      pointerEvents="box-none"
      style={
        props.centeredOnWidth === undefined
          ? {
              alignItems: "center",
              bottom: 0,
              flexDirection: "row",
              left: 0,
              maxWidth: props.maxWidth,
              opacity,
              position: "absolute",
              right: props.grow === true ? 0 : undefined,
              top: 0,
            }
          : {
              alignItems: "center",
              bottom: 0,
              flexDirection: "row",
              justifyContent: "center",
              // Never narrower than the slot UIKit already fit between the
              // header actions, never wider than the room either side allows.
              left:
                (props.centeredOnWidth - Math.max(props.centeredOnWidth, props.maxWidth ?? 0)) / 2,
              opacity,
              position: "absolute",
              top: 0,
              width: Math.max(props.centeredOnWidth, props.maxWidth ?? 0),
            }
      }
    >
      {props.children}
    </Animated.View>
  );
}

/**
 * Renders the brand/title slot of a thread-list surface, overlaying the
 * workspace connection status while an environment is unavailable.
 *
 * Both states occupy the same slot, so connection changes never shift the
 * layout below. The brand stays mounted (hidden with opacity) for the life of
 * the slot: swapping it out of a native header item remounts CompactBrandTitle
 * inside RNSScreenStackHeaderSubview, and that hosted view stays blank after
 * reconnect. Replaces the old WorkspaceConnectionStatus pill, which inserted
 * a row above the thread list.
 */
export function WorkspaceConnectionTitle(props: {
  /** Content shown while connected (brand lockup or a screen title). */
  readonly brand: ReactNode;
  /** Opens environment settings. Status is not pressable when omitted. */
  readonly onPress?: () => void;
  /** Fill the available row width (in-flow headers) instead of hugging content (native title slots). */
  readonly grow?: boolean;
  readonly size?: "navbar" | "pageTitle";
  /** Horizontal correction so the status aligns with the brand in native title slots. */
  readonly statusOffset?: number;
  /** Space available beside the native header actions. */
  readonly maxWidth?: number;
  /** The slot is a centered navigation-bar title: the status centers on the
      brand and uses the short label. */
  readonly centered?: boolean;
}) {
  const status = useDelayedConnectionStatus();
  const size = props.size ?? "navbar";
  const showingStatus = status !== null;
  const { scale } = useAndroidControlSizing();
  const [slotWidth, setSlotWidth] = useState(0);

  return (
    <View
      collapsable={false}
      onLayout={
        props.centered === true
          ? (event) => setSlotWidth(event.nativeEvent.layout.width)
          : undefined
      }
      style={[
        { alignItems: "center", flexDirection: "row" },
        props.grow ? { flex: 1, minWidth: 0 } : null,
      ]}
    >
      <View
        accessibilityElementsHidden={showingStatus}
        collapsable={false}
        importantForAccessibility={showingStatus ? "no-hide-descendants" : "auto"}
        pointerEvents={showingStatus ? "none" : "auto"}
        style={[
          props.grow ? { flex: 1, minWidth: 0 } : null,
          showingStatus ? { opacity: 0 } : null,
        ]}
      >
        {props.brand}
      </View>
      {status !== null ? (
        <StatusFadeIn
          centeredOnWidth={props.centered === true ? slotWidth : undefined}
          grow={props.grow}
          maxWidth={props.maxWidth}
        >
          <Pressable
            accessibilityHint="Opens environment settings"
            accessibilityLabel={status.label}
            accessibilityRole="button"
            disabled={props.onPress === undefined}
            hitSlop={8}
            onPress={props.onPress}
            className="flex-row items-center gap-2"
            style={[
              { flexShrink: 1, marginLeft: props.statusOffset ?? 0 },
              Platform.OS === "android" && { gap: 7 * scale },
            ]}
          >
            {status.showsProgress ? (
              <ActivityIndicator
                colorClassName={"accent-icon-muted"}
                size={Platform.OS === "android" ? Math.round(20 * scale) : "small"}
              />
            ) : (
              <SymbolView
                name="wifi.slash"
                size={Math.round((size === "pageTitle" ? 17 : 15) * scale)}
                tintColorClassName={"accent-icon-muted"}
                type="monochrome"
              />
            )}
            <Text
              className="font-t3-bold text-foreground-muted"
              numberOfLines={1}
              style={{ flexShrink: 1, fontSize: (size === "pageTitle" ? 20 : 16) * scale }}
            >
              {props.centered === true ? status.shortLabel : status.label}
            </Text>
          </Pressable>
        </StatusFadeIn>
      ) : null}
    </View>
  );
}

/**
 * getCompactBrandHeaderOptions with the brand slot upgraded to the
 * connection-status swap. Screens with an environment-settings callback apply
 * this over the static brand options at mount.
 */
export function getConnectionAwareBrandHeaderOptions(opts: {
  readonly headerWidth: number;
  readonly trailingItemCount?: number;
  readonly onOpenEnvironments: () => void;
  readonly fallbackTitleStyle?: NativeStackNavigationOptions["headerTitleStyle"];
}): NativeStackNavigationOptions {
  // Leave room for bar margins, title spacing and the 44-point native actions.
  // Long status labels must not push Settings into UIKit's overflow menu.
  const trailingItemCount = opts.trailingItemCount ?? 1;
  // Phones center the title, so the status may only use the width that
  // clears the trailing actions on both sides.
  const centered = Platform.OS === "ios" && !Platform.isPad;
  const trailingWidth = 16 + 44 * trailingItemCount + 12 * Math.max(0, trailingItemCount - 1);
  const maxWidth = Math.max(
    0,
    centered
      ? opts.headerWidth - 2 * (trailingWidth + 8)
      : opts.headerWidth - 64 - 44 * trailingItemCount,
  );

  return {
    ...getCompactBrandHeaderOptions(opts.fallbackTitleStyle),
    headerTitle: () => (
      <WorkspaceConnectionTitle
        brand={<CompactBrandTitle />}
        centered={centered}
        maxWidth={maxWidth}
        onPress={opts.onOpenEnvironments}
        statusOffset={brandTitleOffset()}
      />
    ),
  };
}
