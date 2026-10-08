import * as Linking from "expo-linking";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { GLASS_CARD_CLASS_NAME, glassCardStyle } from "../scenery/glassStyles";
import { UNSPLASH_UTM, type SceneryPhoto } from "../scenery/sceneryLogic";
import type { ThreadListV2Badge } from "../threads/threadListV2";
import type { HomeGlanceSummary } from "./home-glance";

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const ACCESSIBLE_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

export interface GlanceTone {
  readonly symbol: AppSymbolName;
  readonly orbClassName: string;
  readonly tintClassName: string;
  /** Solid hue for status dots and pulse rings, readable on light and dark glass. */
  readonly dot: string;
}

// Same hues as the card status pills below, so the orb and the cards agree.
export const TONE_BY_BADGE: Record<ThreadListV2Badge, GlanceTone> = {
  approval: {
    symbol: "exclamationmark.circle",
    orbClassName: "bg-adaptive-amber-500-a12-a16",
    tintClassName: "accent-adaptive-amber-700-300",
    dot: "#F5B83D",
  },
  input: {
    symbol: "text.bubble",
    orbClassName: "bg-adaptive-indigo-500-a12-a16",
    tintClassName: "accent-adaptive-indigo-600-300",
    dot: "#8B93F8",
  },
  failed: {
    symbol: "exclamationmark.triangle",
    orbClassName: "bg-adaptive-rose-500-a12-a16",
    tintClassName: "accent-adaptive-rose-700-300",
    dot: "#F47184",
  },
  limited: {
    symbol: "timer",
    orbClassName: "bg-adaptive-amber-500-a12-a16",
    tintClassName: "accent-adaptive-amber-700-300",
    dot: "#F5B83D",
  },
  working: {
    symbol: "sparkles",
    orbClassName: "bg-adaptive-sky-500-a12-a16",
    tintClassName: "accent-adaptive-sky-700-300",
    dot: "#4CB8F0",
  },
  monitoring: {
    symbol: "eye",
    orbClassName: "bg-adaptive-zinc-500-a12-a16",
    tintClassName: "accent-foreground",
    dot: "#A1A1AA",
  },
  done: {
    symbol: "checkmark",
    orbClassName: "bg-adaptive-emerald-500-a12-a16",
    tintClassName: "accent-adaptive-emerald-700-300",
    dot: "#3FCB8E",
  },
};

export const CAUGHT_UP_TONE: GlanceTone = {
  symbol: "sun.max",
  orbClassName: "bg-adaptive-emerald-500-a12-a16",
  tintClassName: "accent-adaptive-emerald-700-300",
  dot: "#3FCB8E",
};

/**
 * Top of the iOS glass Home list: one frosted card with the most urgent
 * state, the other states, today's date, and where today's photo was taken.
 * It scrolls away with the list and is left out while searching.
 */
export const HomeGlance = memo(function HomeGlance(props: {
  readonly summary: HomeGlanceSummary;
  /** Local date being shown; follows the list's minute clock past midnight. */
  readonly date: Date;
  /** Today's photo behind Home, credited here. */
  readonly photo: SceneryPhoto | null;
}) {
  const { headline, detail, tone } = props.summary;
  const glanceTone = tone === null ? CAUGHT_UP_TONE : TONE_BY_BADGE[tone];
  const dateLabel = DATE_FORMATTER.format(props.date);
  return (
    // Same inset, fill and edge as the thread cards below.
    <View className="px-3 pb-1">
      <View
        className={cn("flex-row items-center gap-3 px-4 py-3", GLASS_CARD_CLASS_NAME)}
        style={glassCardStyle()}
      >
        <View
          className={cn("size-9 items-center justify-center rounded-full", glanceTone.orbClassName)}
        >
          <SymbolView
            name={glanceTone.symbol}
            size={15}
            tintColorClassName={glanceTone.tintClassName}
            type="monochrome"
            weight="semibold"
          />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <View
            accessible
            accessibilityLabel={[ACCESSIBLE_DATE_FORMATTER.format(props.date), headline, detail]
              .filter(Boolean)
              .join(". ")}
            accessibilityRole="header"
            className="flex-row items-baseline gap-2"
          >
            <Text
              className="shrink text-base font-t3-bold tracking-tight text-foreground"
              numberOfLines={1}
            >
              {headline}
            </Text>
            <Text className="ml-auto shrink-0 text-xs font-t3-medium uppercase tracking-[0.4px] text-foreground-secondary">
              {dateLabel}
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            {detail !== null ? (
              <Text
                className="shrink text-xs text-foreground-secondary"
                // Already read out by the header row above.
                accessibilityElementsHidden
                importantForAccessibility="no"
                numberOfLines={1}
              >
                {detail}
              </Text>
            ) : null}
            {props.photo !== null ? <HomeGlancePhotoCredit photo={props.photo} /> : null}
          </View>
        </View>
      </View>
    </View>
  );
});

export function HomeGlancePhotoCredit(props: {
  readonly photo: SceneryPhoto;
  readonly className?: string;
}) {
  const { photo } = props;
  const profileURL =
    photo.photographerProfileURL !== null
      ? `${photo.photographerProfileURL}${UNSPLASH_UTM}`
      : `https://unsplash.com/${UNSPLASH_UTM}`;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Wallpaper: ${photo.name}. Photo by ${photo.photographerName} on Unsplash.`}
      className={props.className ?? "ml-auto max-w-[60%] shrink flex-row items-center gap-1"}
      hitSlop={8}
      onPress={() => void Linking.openURL(profileURL).catch(() => undefined)}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <SymbolView
        name="camera"
        size={10}
        tintColorClassName="accent-foreground-tertiary"
        type="monochrome"
      />
      <Text className="shrink text-2xs text-foreground-tertiary" numberOfLines={1}>
        {photo.name} · {photo.photographerName}
      </Text>
    </Pressable>
  );
}
